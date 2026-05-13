use serde::{Deserialize, Serialize};

const EQ_LOW_HZ: f64 = 100.0;
const EQ_MID_HZ: f64 = 1_000.0;
const EQ_HIGH_HZ: f64 = 10_000.0;
const EQ_SHELF_SLOPE: f64 = 1.0;
const EQ_MID_Q: f64 = 0.707;
const EQ_EPSILON_DB: f32 = 0.000_001;
const MBC_LOW_CROSSOVER_HZ: f32 = 120.0;
const MBC_HIGH_CROSSOVER_HZ: f32 = 4_000.0;
const BUTTERWORTH_Q: f32 = 0.707_106_8;
const MBC_ATTACK_SECONDS: f32 = 0.015;
const MBC_RELEASE_SECONDS: f32 = 0.180;
const MBC_EPSILON: f32 = 0.000_000_001;
const MBC_RMS_WINDOW_SECONDS: f32 = 0.010;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct EqSettings {
    #[serde(default, alias = "lowDb", alias = "bassDb")]
    pub low_db: f32,
    #[serde(default, alias = "midDb", alias = "presenceDb")]
    pub mid_db: f32,
    #[serde(default, alias = "highDb", alias = "airDb")]
    pub high_db: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct BiquadCoeffs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl BiquadCoeffs {
    pub fn low_shelf(sample_rate: f32, frequency_hz: f32, gain_db: f32) -> Self {
        shelf(
            sample_rate,
            frequency_hz,
            gain_db,
            EQ_SHELF_SLOPE,
            ShelfKind::Low,
        )
    }

    pub fn peak(sample_rate: f32, frequency_hz: f32, q: f32, gain_db: f32) -> Self {
        let amplitude = 10.0_f64.powf(f64::from(gain_db) / 40.0);
        let omega = 2.0 * std::f64::consts::PI * f64::from(frequency_hz) / f64::from(sample_rate);
        let alpha = omega.sin() / (2.0 * f64::from(q).max(0.000_001));
        let cos_omega = omega.cos();

        normalize(
            1.0 + (alpha * amplitude),
            -2.0 * cos_omega,
            1.0 - (alpha * amplitude),
            1.0 + (alpha / amplitude),
            -2.0 * cos_omega,
            1.0 - (alpha / amplitude),
        )
    }

    pub fn high_shelf(sample_rate: f32, frequency_hz: f32, gain_db: f32) -> Self {
        shelf(
            sample_rate,
            frequency_hz,
            gain_db,
            EQ_SHELF_SLOPE,
            ShelfKind::High,
        )
    }

    pub fn butter_lowpass(sample_rate: f32, frequency_hz: f32, q: f32) -> Self {
        let omega = 2.0 * std::f64::consts::PI * f64::from(frequency_hz) / f64::from(sample_rate);
        let alpha = omega.sin() / (2.0 * f64::from(q).max(0.000_001));
        let cos_omega = omega.cos();
        normalize(
            (1.0 - cos_omega) * 0.5,
            1.0 - cos_omega,
            (1.0 - cos_omega) * 0.5,
            1.0 + alpha,
            -2.0 * cos_omega,
            1.0 - alpha,
        )
    }

    pub fn butter_highpass(sample_rate: f32, frequency_hz: f32, q: f32) -> Self {
        let omega = 2.0 * std::f64::consts::PI * f64::from(frequency_hz) / f64::from(sample_rate);
        let alpha = omega.sin() / (2.0 * f64::from(q).max(0.000_001));
        let cos_omega = omega.cos();
        normalize(
            (1.0 + cos_omega) * 0.5,
            -(1.0 + cos_omega),
            (1.0 + cos_omega) * 0.5,
            1.0 + alpha,
            -2.0 * cos_omega,
            1.0 - alpha,
        )
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    coeffs: Option<BiquadCoeffs>,
    z1: f64,
    z2: f64,
}

impl Biquad {
    pub fn new(coeffs: BiquadCoeffs) -> Self {
        Self {
            coeffs: Some(coeffs),
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub fn bypass() -> Self {
        Self::default()
    }

    pub fn process(&mut self, sample: f32) -> f32 {
        let Some(coeffs) = self.coeffs else {
            return sample;
        };
        let x = f64::from(sample);
        let y = (coeffs.b0 * x) + self.z1;
        self.z1 = (coeffs.b1 * x) - (coeffs.a1 * y) + self.z2;
        self.z2 = (coeffs.b2 * x) - (coeffs.a2 * y);
        y as f32
    }
}

pub fn process_eq(samples: &mut [f32], settings: &EqSettings, sample_rate: f32) {
    let mut processor = EqProcessor::new(*settings, sample_rate);

    for frame in samples.chunks_exact_mut(2) {
        let (left, right) = processor.process_stereo(frame[0], frame[1]);
        frame[0] = left;
        frame[1] = right;
    }
}

pub struct EqProcessor {
    settings: EqSettings,
    sample_rate: f32,
    left_chain: [Biquad; 3],
    right_chain: [Biquad; 3],
}

impl EqProcessor {
    pub fn new(settings: EqSettings, sample_rate: f32) -> Self {
        Self {
            settings,
            sample_rate,
            left_chain: eq_chain(&settings, sample_rate),
            right_chain: eq_chain(&settings, sample_rate),
        }
    }

    pub fn update(&mut self, settings: EqSettings) {
        if self.settings == settings {
            return;
        }
        self.settings = settings;
        self.left_chain = eq_chain(&settings, self.sample_rate);
        self.right_chain = eq_chain(&settings, self.sample_rate);
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        (
            process_chain(left, &mut self.left_chain),
            process_chain(right, &mut self.right_chain),
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct MbcSettings {
    #[serde(default, alias = "thresholdDbfs")]
    pub threshold_dbfs: f32,
    #[serde(default = "default_mbc_ratio")]
    pub ratio: f32,
    #[serde(default = "default_mbc_attack_seconds", alias = "attackSeconds")]
    pub attack_seconds: f32,
    #[serde(default = "default_mbc_release_seconds", alias = "releaseSeconds")]
    pub release_seconds: f32,
    #[serde(default, alias = "kneeDb")]
    pub knee_db: f32,
    #[serde(default, alias = "makeupDb")]
    pub makeup_db: f32,
}

impl Default for MbcSettings {
    fn default() -> Self {
        Self {
            threshold_dbfs: 0.0,
            ratio: 1.0,
            attack_seconds: MBC_ATTACK_SECONDS,
            release_seconds: MBC_RELEASE_SECONDS,
            knee_db: 0.0,
            makeup_db: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MbcTraceFrame {
    pub frame: usize,
    pub low_gr_db: f32,
    pub mid_gr_db: f32,
    pub high_gr_db: f32,
}

pub fn process_mbc(samples: &mut [f32], settings: &MbcSettings, sample_rate: f32) {
    let mut processor = MultibandCompressor::new(*settings, sample_rate);
    for frame in samples.chunks_exact_mut(2) {
        let (left, right, _) = processor.process_stereo(frame[0], frame[1]);
        frame[0] = left;
        frame[1] = right;
    }
}

pub fn process_mbc_with_trace(
    samples: &mut [f32],
    settings: &MbcSettings,
    sample_rate: f32,
    trace_hz: f32,
) -> Vec<MbcTraceFrame> {
    let mut processor = MultibandCompressor::new(*settings, sample_rate);
    let trace_interval = (sample_rate / trace_hz.max(1.0)).round().max(1.0) as usize;
    let mut trace = Vec::new();
    for (frame_index, frame) in samples.chunks_exact_mut(2).enumerate() {
        let (left, right, reductions) = processor.process_stereo(frame[0], frame[1]);
        frame[0] = left;
        frame[1] = right;
        if frame_index % trace_interval == 0 {
            trace.push(MbcTraceFrame {
                frame: frame_index,
                low_gr_db: reductions[0],
                mid_gr_db: reductions[1],
                high_gr_db: reductions[2],
            });
        }
    }
    trace
}

pub struct MultibandCompressor {
    settings: MbcSettings,
    left_splitter: Lr4Splitter,
    right_splitter: Lr4Splitter,
    bands: [BandCompressor; 3],
}

impl MultibandCompressor {
    pub fn new(settings: MbcSettings, sample_rate: f32) -> Self {
        Self {
            settings,
            left_splitter: Lr4Splitter::new(sample_rate),
            right_splitter: Lr4Splitter::new(sample_rate),
            bands: [
                BandCompressor::new(sample_rate),
                BandCompressor::new(sample_rate),
                BandCompressor::new(sample_rate),
            ],
        }
    }

    pub fn update(&mut self, settings: MbcSettings) {
        self.settings = settings;
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32, [f32; 3]) {
        if !mbc_active(&self.settings) {
            return (left, right, [0.0; 3]);
        }

        let left_bands = self.left_splitter.split(left);
        let right_bands = self.right_splitter.split(right);
        let mut out_left = 0.0_f32;
        let mut out_right = 0.0_f32;
        let mut reductions = [0.0_f32; 3];

        for band in 0..3 {
            let detector = left_bands[band].abs().max(right_bands[band].abs());
            let (gain, gr_db) = self.bands[band].gain(detector, &self.settings);
            out_left += left_bands[band] * gain;
            out_right += right_bands[band] * gain;
            reductions[band] = gr_db;
        }

        (out_left, out_right, reductions)
    }
}

#[derive(Clone, Debug)]
struct BandCompressor {
    sample_rate: f32,
    attack_coeff: f32,
    release_coeff: f32,
    rms: RmsDetector,
    envelope: f32,
}

impl BandCompressor {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            attack_coeff: time_coeff(MBC_ATTACK_SECONDS, sample_rate),
            release_coeff: time_coeff(MBC_RELEASE_SECONDS, sample_rate),
            rms: RmsDetector::new(sample_rate),
            envelope: 0.0,
        }
    }

    fn gain(&mut self, detector: f32, settings: &MbcSettings) -> (f32, f32) {
        self.attack_coeff = time_coeff(settings.attack_seconds, self.sample_rate);
        self.release_coeff = time_coeff(settings.release_seconds, self.sample_rate);
        let level = self.rms.process(detector);
        let coeff = if level > self.envelope {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.envelope = (coeff * self.envelope) + ((1.0 - coeff) * level);
        let input_db = amplitude_to_db(self.envelope);
        let reduction_db = gain_reduction_db(
            input_db,
            settings.threshold_dbfs,
            settings.ratio,
            settings.knee_db,
        );
        let gain = db_to_amplitude(reduction_db + settings.makeup_db);
        (gain, -reduction_db)
    }
}

#[derive(Clone, Debug)]
struct RmsDetector {
    squares: Vec<f32>,
    index: usize,
    sum: f64,
}

impl RmsDetector {
    fn new(sample_rate: f32) -> Self {
        let frames = (sample_rate * MBC_RMS_WINDOW_SECONDS).round().max(1.0) as usize;
        Self {
            squares: vec![0.0; frames],
            index: 0,
            sum: 0.0,
        }
    }

    fn process(&mut self, sample: f32) -> f32 {
        let square = sample * sample;
        self.sum += f64::from(square - self.squares[self.index]);
        self.squares[self.index] = square;
        self.index = (self.index + 1) % self.squares.len();
        (self.sum.max(0.0) / self.squares.len() as f64).sqrt() as f32
    }
}

#[derive(Clone, Copy, Debug)]
struct Lr4Splitter {
    low_lp1: Biquad,
    low_lp2: Biquad,
    mid_hp1: Biquad,
    mid_hp2: Biquad,
    mid_lp1: Biquad,
    mid_lp2: Biquad,
    high_hp1: Biquad,
    high_hp2: Biquad,
}

impl Lr4Splitter {
    fn new(sample_rate: f32) -> Self {
        let low_lp = BiquadCoeffs::butter_lowpass(sample_rate, MBC_LOW_CROSSOVER_HZ, BUTTERWORTH_Q);
        let mid_hp =
            BiquadCoeffs::butter_highpass(sample_rate, MBC_LOW_CROSSOVER_HZ, BUTTERWORTH_Q);
        let mid_lp =
            BiquadCoeffs::butter_lowpass(sample_rate, MBC_HIGH_CROSSOVER_HZ, BUTTERWORTH_Q);
        let high_hp =
            BiquadCoeffs::butter_highpass(sample_rate, MBC_HIGH_CROSSOVER_HZ, BUTTERWORTH_Q);
        Self {
            low_lp1: Biquad::new(low_lp),
            low_lp2: Biquad::new(low_lp),
            mid_hp1: Biquad::new(mid_hp),
            mid_hp2: Biquad::new(mid_hp),
            mid_lp1: Biquad::new(mid_lp),
            mid_lp2: Biquad::new(mid_lp),
            high_hp1: Biquad::new(high_hp),
            high_hp2: Biquad::new(high_hp),
        }
    }

    fn split(&mut self, sample: f32) -> [f32; 3] {
        let low = self.low_lp2.process(self.low_lp1.process(sample));
        let mid_high = self.mid_hp2.process(self.mid_hp1.process(sample));
        let mid = self.mid_lp2.process(self.mid_lp1.process(mid_high));
        let high = self.high_hp2.process(self.high_hp1.process(sample));
        [low, mid, high]
    }
}

fn mbc_active(settings: &MbcSettings) -> bool {
    settings.ratio > 1.000_001 && settings.threshold_dbfs < 0.0
}

fn default_mbc_ratio() -> f32 {
    1.0
}

fn default_mbc_attack_seconds() -> f32 {
    MBC_ATTACK_SECONDS
}

fn default_mbc_release_seconds() -> f32 {
    MBC_RELEASE_SECONDS
}

fn time_coeff(seconds: f32, sample_rate: f32) -> f32 {
    (-1.0 / (seconds.max(0.000_001) * sample_rate.max(1.0))).exp()
}

fn amplitude_to_db(value: f32) -> f32 {
    20.0 * value.max(MBC_EPSILON).log10()
}

fn db_to_amplitude(value: f32) -> f32 {
    10.0_f32.powf(value / 20.0)
}

fn gain_reduction_db(input_db: f32, threshold_dbfs: f32, ratio: f32, knee_db: f32) -> f32 {
    let ratio = ratio.max(1.0);
    let knee = knee_db.max(0.0);
    if knee <= 0.0 {
        let over_db = (input_db - threshold_dbfs).max(0.0);
        return -over_db * (1.0 - (1.0 / ratio));
    }

    let lower = threshold_dbfs - (knee * 0.5);
    let upper = threshold_dbfs + (knee * 0.5);
    let output_db = if input_db <= lower {
        input_db
    } else if input_db >= upper {
        threshold_dbfs + ((input_db - threshold_dbfs) / ratio)
    } else {
        input_db + (((1.0 / ratio) - 1.0) * (input_db - lower).powi(2) / (2.0 * knee))
    };
    output_db - input_db
}

fn eq_chain(settings: &EqSettings, sample_rate: f32) -> [Biquad; 3] {
    [
        biquad_or_bypass(settings.low_db, || {
            BiquadCoeffs::low_shelf(sample_rate, EQ_LOW_HZ as f32, settings.low_db)
        }),
        biquad_or_bypass(settings.mid_db, || {
            BiquadCoeffs::peak(
                sample_rate,
                EQ_MID_HZ as f32,
                EQ_MID_Q as f32,
                settings.mid_db,
            )
        }),
        biquad_or_bypass(settings.high_db, || {
            BiquadCoeffs::high_shelf(sample_rate, EQ_HIGH_HZ as f32, settings.high_db)
        }),
    ]
}

fn biquad_or_bypass(gain_db: f32, build: impl FnOnce() -> BiquadCoeffs) -> Biquad {
    if gain_db.abs() <= EQ_EPSILON_DB {
        Biquad::bypass()
    } else {
        Biquad::new(build())
    }
}

fn process_chain(mut sample: f32, chain: &mut [Biquad; 3]) -> f32 {
    for biquad in chain {
        sample = biquad.process(sample);
    }
    sample
}

#[derive(Clone, Copy)]
enum ShelfKind {
    Low,
    High,
}

fn shelf(
    sample_rate: f32,
    frequency_hz: f32,
    gain_db: f32,
    slope: f64,
    kind: ShelfKind,
) -> BiquadCoeffs {
    let amplitude = 10.0_f64.powf(f64::from(gain_db) / 40.0);
    let omega = 2.0 * std::f64::consts::PI * f64::from(frequency_hz) / f64::from(sample_rate);
    let sin_omega = omega.sin();
    let cos_omega = omega.cos();
    let alpha = (sin_omega / 2.0)
        * (((amplitude + (1.0 / amplitude)) * ((1.0 / slope) - 1.0)) + 2.0)
            .max(0.0)
            .sqrt();
    let beta = 2.0 * amplitude.sqrt() * alpha;

    let (b0, b1, b2, a0, a1, a2) = match kind {
        ShelfKind::Low => (
            amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + beta),
            2.0 * amplitude * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
            amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - beta),
            (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + beta,
            -2.0 * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
            (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - beta,
        ),
        ShelfKind::High => (
            amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + beta),
            -2.0 * amplitude * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
            amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - beta),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + beta,
            2.0 * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - beta,
        ),
    };

    normalize(b0, b1, b2, a0, a1, a2)
}

fn normalize(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> BiquadCoeffs {
    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_eq_is_identity_for_stereo_samples() {
        let mut samples = vec![-0.25, 0.2, 0.0, 0.1, 0.5, -0.5, 0.25, -0.125];
        let original = samples.clone();

        process_eq(&mut samples, &EqSettings::default(), 48_000.0);

        assert_eq!(samples, original);
    }

    #[test]
    fn boosted_eq_changes_signal_without_nan() {
        let mut samples = (0..4_800)
            .flat_map(|index| {
                let value =
                    ((index as f32 / 48_000.0) * 2.0 * std::f32::consts::PI * 440.0).sin() * 0.25;
                [value, value]
            })
            .collect::<Vec<_>>();

        process_eq(
            &mut samples,
            &EqSettings {
                low_db: 3.0,
                mid_db: 3.0,
                high_db: 3.0,
            },
            48_000.0,
        );

        assert!(samples.iter().all(|sample| sample.is_finite()));
        assert!(samples.iter().any(|sample| sample.abs() > 0.251));
    }
}
