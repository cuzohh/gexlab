package gexlab;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Stroke;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import com.motivewave.platform.sdk.common.Coordinate;
import com.motivewave.platform.sdk.common.DataContext;
import com.motivewave.platform.sdk.common.DataSeries;
import com.motivewave.platform.sdk.common.Defaults;
import com.motivewave.platform.sdk.common.Enums;
import com.motivewave.platform.sdk.common.Instrument;
import com.motivewave.platform.sdk.common.NVP;
import com.motivewave.platform.sdk.common.desc.BooleanDescriptor;
import com.motivewave.platform.sdk.common.desc.DiscreteDescriptor;
import com.motivewave.platform.sdk.common.desc.DoubleDescriptor;
import com.motivewave.platform.sdk.common.desc.IntegerDescriptor;
import com.motivewave.platform.sdk.common.desc.StringDescriptor;
import com.motivewave.platform.sdk.draw.Box;
import com.motivewave.platform.sdk.draw.Label;
import com.motivewave.platform.sdk.draw.Line;
import com.motivewave.platform.sdk.study.Study;
import com.motivewave.platform.sdk.study.StudyHeader;

/**
 * Draws the GEXLab V3 option levels on an NQ or ES futures chart.
 *
 * This is the MotiveWave counterpart to the Pine indicator and consumes the
 * identical bridge payload, so a payload copied once can be pasted into either
 * platform. Each SPX|NDX section contains a fixed aggregate block, then "~",
 * then every selected expiry as DTE:call wall:put wall:gamma flip.
 *
 * Aggregate block: CW, PW, flip, max pain, vanna, five positive gamma, five
 * negative gamma, three positive delta, three negative delta levels.
 */
@StudyHeader(
    namespace = "com.gexlab",
    id = "GEXLAB_V3_LEVELS",
    name = "GEXLab V3 Futures Levels",
    label = "GEXLab",
    desc = "Draws GEXLab V3 option walls, gamma flips, and concentrations from a copied bridge payload.",
    menu = "GEXLab",
    overlay = true,
    studyOverlay = true,
    requiresBarUpdates = false)
public class GexLabLevels extends Study
{
  // Settings
  final static String BRIDGE = "bridge";
  final static String CONVERSION = "conversion";
  final static String INDEX_SPOT = "indexSpot";
  final static String MANUAL_NQ_RATIO = "manualNqRatio";
  final static String MANUAL_ES_RATIO = "manualEsRatio";
  final static String MANUAL_NQ_BASIS = "manualNqBasis";
  final static String MANUAL_ES_BASIS = "manualEsBasis";
  final static String SHOW_EXPIRY_WALLS = "showExpiryWalls";
  final static String SHOW_AGGREGATE_WALLS = "showAggregateWalls";
  final static String SHOW_FLIPS = "showFlips";
  final static String SHOW_MAX_PAIN = "showMaxPain";
  final static String SHOW_VANNA = "showVanna";
  final static String SHOW_GAMMA = "showGamma";
  final static String SHOW_DELTA = "showDelta";
  final static String SHOW_ZONES = "showZones";
  final static String ZONE_HALF_WIDTH = "zoneHalfWidth";
  final static String LOOKBACK = "lookback";
  final static String SHOW_STATUS = "showStatus";

  // Conversion modes
  final static String AS_IS = "asIs";
  final static String FROM_SPOT = "fromSpot";
  final static String MANUAL_RATIO = "manualRatio";
  final static String MANUAL_BASIS = "manualBasis";

  // Palette shared with the Pine indicator.
  final static Color CALL_COLOR = new Color(0x2f6b5f);
  final static Color PUT_COLOR = new Color(0xa0443b);
  final static Color FLIP_COLOR = new Color(0x8a641f);
  final static Color PAIN_COLOR = new Color(0x6f6378);
  final static Color VANNA_COLOR = new Color(0x315f78);

  final static int FIXED_VALUE_COUNT = 21;
  final static int EXTEND_BARS = 25;

  @Override
  public void initialize(Defaults defaults)
  {
    var sd = createSD();
    var tab = sd.addTab("General");

    var data = tab.addGroup("Data");
    data.addRow(new StringDescriptor(BRIDGE, "GEXLab bridge", "").setHeight(90));

    var conversion = tab.addGroup("Conversion");
    conversion.addRow(new DiscreteDescriptor(CONVERSION, "Index to futures", AS_IS, List.of(
        new NVP("Use payload as-is", AS_IS),
        new NVP("Index spot to live ratio", FROM_SPOT),
        new NVP("Manual ratio", MANUAL_RATIO),
        new NVP("Manual basis", MANUAL_BASIS))));
    conversion.addRow(new DoubleDescriptor(INDEX_SPOT, "Index spot at export", 0, 0, 1000000, 0.01));
    conversion.addRow(new DoubleDescriptor(MANUAL_NQ_RATIO, "Manual NQ / NDX ratio", 1.0, 0.5, 2.0, 0.00001));
    conversion.addRow(new DoubleDescriptor(MANUAL_ES_RATIO, "Manual ES / SPX ratio", 1.0, 0.5, 2.0, 0.00001));
    conversion.addRow(new DoubleDescriptor(MANUAL_NQ_BASIS, "Manual NQ - NDX basis", 0.0, -100000, 100000, 0.25));
    conversion.addRow(new DoubleDescriptor(MANUAL_ES_BASIS, "Manual ES - SPX basis", 0.0, -100000, 100000, 0.25));
    conversion.addRow(new BooleanDescriptor(SHOW_STATUS, "Show status label", true));

    var levels = tab.addGroup("Levels");
    levels.addRow(new BooleanDescriptor(SHOW_EXPIRY_WALLS, "Selected-expiry walls", true));
    levels.addRow(new BooleanDescriptor(SHOW_AGGREGATE_WALLS, "Combined walls", true));
    levels.addRow(new BooleanDescriptor(SHOW_FLIPS, "Gamma flips", true));
    levels.addRow(new BooleanDescriptor(SHOW_MAX_PAIN, "Max pain", true));
    levels.addRow(new BooleanDescriptor(SHOW_VANNA, "Vanna magnet", true));
    levels.addRow(new BooleanDescriptor(SHOW_GAMMA, "Gamma concentrations", true));
    levels.addRow(new BooleanDescriptor(SHOW_DELTA, "Delta concentrations", true));

    var style = tab.addGroup("Style");
    style.addRow(new BooleanDescriptor(SHOW_ZONES, "Level zones", true));
    style.addRow(new DoubleDescriptor(ZONE_HALF_WIDTH, "Zone half-width (0 = auto)", 0.0, 0.0, 10000.0, 0.25));
    style.addRow(new IntegerDescriptor(LOOKBACK, "Bars drawn", 500, 20, 5000, 10));

    setRuntimeDescriptor(createRD());
  }

  /** State for one redraw, so the parsing and conversion inputs are read once. */
  private class Frame
  {
    final boolean isNq;
    final boolean isEs;
    final boolean payloadIsFutures;
    final String body;
    final Double ratio;
    final Double basis;
    final String mode;
    final double halfWidth;
    final long startTime;
    final long endTime;
    final Font font;
    final String status;

    Frame(DataContext ctx)
    {
      DataSeries series = ctx.getDataSeries();
      Instrument instrument = ctx.getInstrument();
      String symbol = instrument.getSymbol() == null ? "" : instrument.getSymbol().toUpperCase();
      isNq = symbol.contains("NQ");
      isEs = symbol.contains("ES");

      String bridge = getSettings().getString(BRIDGE);
      if (bridge == null) bridge = "";
      bridge = bridge.trim();
      payloadIsFutures = bridge.startsWith("F#");
      body = (payloadIsFutures || bridge.startsWith("N#")) ? bridge.substring(2) : bridge;

      mode = getSettings().getString(CONVERSION, AS_IS);
      double configured = getSettings().getDouble(ZONE_HALF_WIDTH, 0.0);
      halfWidth = configured > 0 ? configured : (isNq ? 20.0 : 5.0);

      int last = series.size() - 1;
      int lookback = getSettings().getInteger(LOOKBACK, 500);
      int first = Math.max(0, last - lookback);
      long barMillis = Math.max(series.getEndTime(last) - series.getStartTime(last), 1);
      startTime = series.getStartTime(first);
      endTime = series.getEndTime(last) + (EXTEND_BARS * barMillis);
      font = ctx.getDefaults().getFont();

      // The payload already carries futures prices, so no conversion applies.
      if (payloadIsFutures) {
        ratio = 1.0;
        basis = 0.0;
      }
      else if (MANUAL_RATIO.equals(mode)) {
        double manual = getSettings().getDouble(isNq ? MANUAL_NQ_RATIO : MANUAL_ES_RATIO, 1.0);
        ratio = manual > 0 ? manual : null;
        basis = null;
      }
      else if (MANUAL_BASIS.equals(mode)) {
        ratio = null;
        basis = getSettings().getDouble(isNq ? MANUAL_NQ_BASIS : MANUAL_ES_BASIS, 0.0);
      }
      else if (FROM_SPOT.equals(mode)) {
        // Mirrors the app's own conversion: level / index spot * live futures price.
        double spot = getSettings().getDouble(INDEX_SPOT, 0.0);
        float close = series.getClose(last);
        ratio = (spot > 0 && close > 0) ? (close / spot) : null;
        basis = null;
      }
      else {
        // Use as-is was selected but the payload is in native index space.
        ratio = null;
        basis = null;
      }

      status = describe(instrument);
    }

    private String describe(Instrument instrument)
    {
      if (!isNq && !isEs) return "GEXLab: use an NQ or ES chart";
      if (body.isEmpty()) return "GEXLab: paste the bridge payload";
      if (payloadIsFutures) return "GEXLab: futures payload, " + (isNq ? "NDX to NQ" : "SPX to ES");
      if (ratio == null && basis == null) {
        if (FROM_SPOT.equals(mode)) return "GEXLab: enter the index spot from the app";
        return "GEXLab: native payload needs a conversion mode";
      }
      String detail = ratio != null
          ? String.format("ratio %.5f", ratio)
          : String.format("basis %.2f", basis);
      return "GEXLab: " + (isNq ? "NDX to NQ" : "SPX to ES") + ", " + detail;
    }

    boolean canDraw()
    {
      if (!isNq && !isEs) return false;
      if (body.isEmpty()) return false;
      return payloadIsFutures || ratio != null || basis != null;
    }

    /** Converts one native index level into chart price space, or null when unavailable. */
    Double convert(double value)
    {
      if (payloadIsFutures) return round(value);
      if (ratio != null) return round(value * ratio);
      if (basis != null) return round(value + basis);
      return null;
    }

    String section()
    {
      return sectionOf(body, isNq);
    }

    String fixedPayload()
    {
      return fixedOf(section());
    }

    String expiryPayload()
    {
      return expiriesOf(section());
    }

    /** Parses one payload field into chart price space. */
    Double parse(String text)
    {
      Double parsed = parseNumber(text);
      return parsed == null ? null : convert(parsed);
    }

    Double value(int index)
    {
      Double parsed = fixedValue(fixedPayload(), index);
      return parsed == null ? null : convert(parsed);
    }
  }

  /** The section for this chart: index 0 is SPX/ES, index 1 is NDX/NQ. */
  static String sectionOf(String body, boolean isNq)
  {
    if (body == null) return "";
    String[] sections = body.split("\\|", -1);
    int index = isNq ? 1 : 0;
    return sections.length > index ? sections[index] : "";
  }

  static String fixedOf(String section)
  {
    String[] parts = section.split("~", -1);
    return parts.length > 0 ? parts[0] : "";
  }

  static String expiriesOf(String section)
  {
    String[] parts = section.split("~", -1);
    return parts.length > 1 ? parts[1] : "";
  }

  /** Parses one payload field. A zero, blank, or unparsable field means "not present". */
  static Double parseNumber(String text)
  {
    if (text == null) return null;
    String trimmed = text.trim();
    if (trimmed.isEmpty()) return null;
    double parsed;
    try {
      parsed = Double.parseDouble(trimmed);
    }
    catch (NumberFormatException e) {
      return null;
    }
    if (parsed == 0 || !Double.isFinite(parsed)) return null;
    return parsed;
  }

  static Double fixedValue(String fixedPayload, int index)
  {
    String[] values = fixedPayload.split(",", -1);
    return values.length > index ? parseNumber(values[index]) : null;
  }

  @Override
  protected void calculateValues(DataContext ctx)
  {
    DataSeries series = ctx.getDataSeries();
    if (series == null || series.size() < 2) return;

    Frame frame = new Frame(ctx);

    if (getSettings().getBoolean(SHOW_STATUS, true)) {
      float close = series.getClose(series.size() - 1);
      if (close > 0) {
        Label label = new Label(new Coordinate(frame.startTime, close), Enums.StackPolicy.ABOVE, frame.status);
        label.setShowLine(false);
        addFigure(label);
      }
    }

    if (!frame.canDraw()) return;

    boolean zones = getSettings().getBoolean(SHOW_ZONES, true);

    if (getSettings().getBoolean(SHOW_AGGREGATE_WALLS, true)) {
      draw(frame, zones, frame.value(0), "Combined Call Wall", CALL_COLOR, true);
      draw(frame, zones, frame.value(1), "Combined Put Wall", PUT_COLOR, true);
    }
    if (getSettings().getBoolean(SHOW_FLIPS, true)) {
      draw(frame, zones, frame.value(2), "Combined Gamma Flip", FLIP_COLOR, true);
    }
    if (getSettings().getBoolean(SHOW_MAX_PAIN, true)) {
      draw(frame, zones, frame.value(3), "Max Pain", PAIN_COLOR, false);
    }
    if (getSettings().getBoolean(SHOW_VANNA, true)) {
      draw(frame, zones, frame.value(4), "Vanna Magnet", VANNA_COLOR, false);
    }

    if (getSettings().getBoolean(SHOW_GAMMA, true)) {
      for (int rank = 0; rank < 5; rank++) {
        draw(frame, zones, frame.value(5 + rank), "Gamma +" + (rank + 1), CALL_COLOR, rank < 2);
        draw(frame, zones, frame.value(10 + rank), "Gamma -" + (rank + 1), PUT_COLOR, rank < 2);
      }
    }

    if (getSettings().getBoolean(SHOW_DELTA, true)) {
      for (int rank = 0; rank < 3; rank++) {
        draw(frame, zones, frame.value(15 + rank), "Delta +" + (rank + 1), VANNA_COLOR, rank == 0);
        draw(frame, zones, frame.value(18 + rank), "Delta -" + (rank + 1), PAIN_COLOR, rank == 0);
      }
    }

    boolean expiryWalls = getSettings().getBoolean(SHOW_EXPIRY_WALLS, true);
    boolean flips = getSettings().getBoolean(SHOW_FLIPS, true);
    List<String> entries = new ArrayList<>(Arrays.asList(frame.expiryPayload().split(";", -1)));
    for (int index = 0; index < entries.size(); index++) {
      String entry = entries.get(index);
      if (entry == null || entry.trim().isEmpty()) continue;
      String[] fields = entry.split(":", -1);
      if (fields.length < 4) continue;
      String name = fields[0].trim();
      boolean front = index == 0;
      if (expiryWalls) {
        draw(frame, zones, frame.parse(fields[1]), name + " Call Wall", CALL_COLOR, front);
        draw(frame, zones, frame.parse(fields[2]), name + " Put Wall", PUT_COLOR, front);
      }
      if (flips) {
        draw(frame, zones, frame.parse(fields[3]), name + " Gamma Flip", FLIP_COLOR, false);
      }
    }
  }

  private void draw(Frame frame, boolean zones, Double price, String text, Color color, boolean strong)
  {
    if (price == null || !Double.isFinite(price)) return;

    if (zones && frame.halfWidth > 0) {
      Box zone = new Box(
          new Coordinate(frame.startTime, price + frame.halfWidth),
          new Coordinate(frame.endTime, price - frame.halfWidth));
      zone.setFillColor(alpha(color, 23));
      zone.setLineColor(alpha(color, 115));
      addFigure(zone);
    }

    Line line = new Line(
        new Coordinate(frame.startTime, price),
        new Coordinate(frame.endTime, price));
    line.setColor(color);
    line.setStroke(strong ? solid() : dotted());
    line.setExtendRightBounds(true);
    line.setText(text, frame.font);
    addFigure(line);
  }

  private static Color alpha(Color color, int alpha)
  {
    return new Color(color.getRed(), color.getGreen(), color.getBlue(), alpha);
  }

  private static Stroke solid()
  {
    return new BasicStroke(2f);
  }

  private static Stroke dotted()
  {
    return new BasicStroke(1f, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER, 10f, new float[] { 2f, 3f }, 0f);
  }
}
