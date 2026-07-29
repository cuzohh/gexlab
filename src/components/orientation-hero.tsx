type OrientationHeroProps = {
  eyebrow: string;
  question: string;
  answer: string;
  detail: string;
  confidence?: number;
  confidenceLabel?: string;
  caveat: string;
};

export function OrientationHero({
  eyebrow,
  question,
  answer,
  detail,
  confidence,
  confidenceLabel = "Signal agreement",
  caveat,
}: OrientationHeroProps) {
  return (
    <section className="orientation-hero reveal">
      <div className="orientation-copy">
        <p className="eyebrow">{eyebrow}</p>
        <p className="orientation-question">{question}</p>
        <h1>{answer}</h1>
        <p className="hero-detail">{detail}</p>
      </div>

      <div className="hero-proof" aria-label="Reading context">
        {confidence !== undefined ? (
          <div className="confidence">
            <div className="confidence-head">
              <span>{confidenceLabel}</span>
              <strong>{confidence}%</strong>
            </div>
            <div
              className="confidence-track"
              role="meter"
              aria-label={`${confidence} percent ${confidenceLabel.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidence}
            >
              <i style={{ width: `${confidence}%` }} />
            </div>
          </div>
        ) : null}
        <p className="hero-caveat">
          <span>What could change it</span>
          {caveat}
        </p>
      </div>
    </section>
  );
}
