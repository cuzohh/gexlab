type MarketLevel = {
  symbol: string;
  price: number;
  putWall: number;
  gammaFlip: number;
  callWall: number;
  state: string;
};

function format(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function StructureStrip({ market }: { market: MarketLevel }) {
  const low = market.putWall - (market.callWall - market.putWall) * 0.12;
  const high = market.callWall + (market.callWall - market.putWall) * 0.12;
  const at = (value: number) => ((value - low) / (high - low)) * 100;
  const supportDistance = market.price - market.putWall;
  const resistanceDistance = market.callWall - market.price;

  return (
    <article className="structure-strip">
      <div className="strip-heading">
        <div>
          <span className="instrument-symbol">{market.symbol}</span>
          <span className="instrument-price">{format(market.price)}</span>
        </div>
        <span className={`state-label state-label--${market.state.toLowerCase()}`}>{market.state}</span>
      </div>

      <div className="level-map" aria-label={`${market.symbol} options structure map`}>
        <div className="level-axis" />
        <div className="level-zone level-zone--support" style={{ left: `${at(market.putWall) - 2.8}%` }} />
        <div className="level-zone level-zone--resistance" style={{ left: `${at(market.callWall) - 2.8}%` }} />

        <div className="level-marker level-marker--put" style={{ left: `${at(market.putWall)}%` }}>
          <i />
          <span>Put wall</span>
          <strong>{format(market.putWall)}</strong>
        </div>
        <div className="level-marker level-marker--flip" style={{ left: `${at(market.gammaFlip)}%` }}>
          <i />
          <span>Gamma flip</span>
          <strong>{format(market.gammaFlip)}</strong>
        </div>
        <div className="level-marker level-marker--price" style={{ left: `${at(market.price)}%` }}>
          <i />
          <span>Now</span>
        </div>
        <div className="level-marker level-marker--call" style={{ left: `${at(market.callWall)}%` }}>
          <i />
          <span>Call wall</span>
          <strong>{format(market.callWall)}</strong>
        </div>
      </div>

      <div className="strip-foot">
        <p>
          <span>{supportDistance} pts</span> to mapped support
        </p>
        <p>
          <span>{resistanceDistance} pts</span> to mapped resistance
        </p>
      </div>
    </article>
  );
}
