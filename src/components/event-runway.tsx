const events = [
  { day: "TODAY", label: "Post-close", detail: "Fresh options snapshot", tone: "neutral" },
  { day: "SUN", label: "Futures open", detail: "6:00 PM ET", tone: "neutral" },
  { day: "MON", label: "Treasury auctions", detail: "Moderate impact", tone: "caution" },
  { day: "TUE", label: "CPI", detail: "8:30 AM · high impact", tone: "stress" },
  { day: "FRI", label: "Monthly expiry", detail: "Settlement risk", tone: "caution" },
] as const;

export function EventRunway() {
  return (
    <section className="event-runway reveal reveal--3">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Event runway</p>
          <h2>What can disturb the map?</h2>
        </div>
        <p>Only events likely to change the current interpretation are shown.</p>
      </div>

      <div className="runway-track">
        {events.map((event, index) => (
          <article className="runway-event" key={`${event.day}-${event.label}`}>
            <span className={`runway-node runway-node--${event.tone}`} aria-hidden="true" />
            <p className="runway-day">{event.day}</p>
            <h3>{event.label}</h3>
            <p>{event.detail}</p>
            {index < events.length - 1 ? <i className="runway-line" aria-hidden="true" /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
