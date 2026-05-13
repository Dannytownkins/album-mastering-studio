use serde::{Deserialize, Serialize};

const EQ_LOW_HZ: f64 = 100.0;
const EQ_MID_HZ: f64 = 1_000.0;
const EQ_HIGH_HZ: f64 = 10_000.0;
const EQ_SHELF_SLOPE: f64 = 1.0;
const EQ_MID_Q: f64 = 0.707;
const EQ_EPSILON_DB: f32 = 0.000_001;

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
        shelf(sample_rate, frequency_hz, gain_db, EQ_SHELF_SLOPE, ShelfKind::Low)
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
        shelf(sample_rate, frequency_hz, gain_db, EQ_SHELF_SLOPE, ShelfKind::High)
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

fn eq_chain(settings: &EqSettings, sample_rate: f32) -> [Biquad; 3] {
    [
        biquad_or_bypass(settings.low_db, || {
            BiquadCoeffs::low_shelf(sample_rate, EQ_LOW_HZ as f32, settings.low_db)
        }),
        biquad_or_bypass(settings.mid_db, || {
            BiquadCoeffs::peak(sample_rate, EQ_MID_HZ as f32, EQ_MID_Q as f32, settings.mid_db)
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
                let value = ((index as f32 / 48_000.0) * 2.0 * std::f32::consts::PI * 440.0).sin()
                    * 0.25;
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
