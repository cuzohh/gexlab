export const PINE_SCRIPT = String.raw`//@version=6
// calc_bars_count and max_bars_back are set together and the pairing is the
// point. Requesting the cash index at the chart's resolution pairs a 24-hour
// futures session with an index that prints far fewer bars, and Pine's offset
// into that series widens at every gap, without limit as the chart lengthens:
// it overran a 493-bar buffer around bar 10,000 and a 1,277-bar buffer around
// bar 10,900. Capping the calculation at 5,000 bars caps that offset at 5,000
// too, which a 5,000-bar buffer covers by construction. Nothing here needs more
// history than that: every drawing is made on the last bar.
indicator("GEXLab V3 Option Levels", overlay=true, max_bars_back=5000, calc_bars_count=5000, max_boxes_count=500, max_lines_count=500, max_labels_count=500)

// Paste the "GX2" bridge payload copied from GEXLab V3.
//
//   GX2#H~<space>~<instrument>~<refSpot>~<epochSec>|<block>|<block>
//   block: <name>~<role>~<spot>~<step>~<agg>~<gamma>~<delta>~<expiries>
//          ~<profile>~<volume>~<move>
//     role      P primary book, C confirmation book (QQQ / SPY)
//     step      that book's strike increment, already rescaled onto refSpot
//     agg       call,put,flip,maxpain,vanna
//     gamma     strike,weight,sign;…   weight 0-100, sign +1 / -1
//     delta     strike,weight,sign;…
//     expiries  label,call,put,flip,dte,settlesEpoch;…   settles 0 = unknown
//     profile   strike,exposure;…      exposure -100…100 of the peak
//     volume    callVolumeWall,putVolumeWall
//     move      oneSigmaBps,frontSettlesEpoch
//
// A payload outlives its own contracts, and payload age cannot detect it: one
// exported at 15:55 is four hours old at 20:00 while its 0DTE walls describe
// options that ceased to exist at the close. So each dated wall travels with the
// instant its expiry settles and is withdrawn once that has passed. The combined
// levels span the whole selection and carry no settlement, which is why the
// subfield is per expiry rather than per block.
//
// Every block carries its own strike increment, measured from the chain rather
// than assumed: on a recent snapshot NDX listed a modal 10-point grid across its
// near expiries while QQQ's $1 grid rescaled onto the index covers about 41
// points. Both are rescaled again by whatever maps the payload onto this chart.
bridge = input.text_area("", "GEXLab bridge", group="Data", tooltip="Copy the bridge from the GEXLab Options workspace. The payload carries its own price space, strike increments and snapshot time.")

map_mode = input.string("Auto", "Chart mapping", options=["Auto", "Cash-index ratio", "Cash-index basis", "Payload-reference ratio", "Manual ratio", "Manual basis", "None"], group="Mapping", tooltip="Auto uses the live cash-index ratio when it is available, which maps the payload onto futures, the cash index itself and the ETF alike. These are observed estimates, not exchange-defined conversions.")
map_samples = input.int(60, "Synchronized samples", minval=1, maxval=600, group="Mapping", tooltip="Averages the ratio over this many bars on which the cash index and this chart both printed, then holds the last valid relationship outside the cash session. Higher values stop the levels jumping during micro-volatility; lower values track a moving basis more closely.")
ndx_symbol = input.symbol("NASDAQ:NDX", "NDX cash index", group="Mapping")
spx_symbol = input.symbol("SP:SPX", "SPX cash index", group="Mapping")
manual_ratio_input = input.float(1.0, "Manual ratio", minval=0.000001, step=0.00001, group="Mapping")
manual_basis_input = input.float(0.0, "Manual basis", step=0.25, group="Mapping")

show_aggregate_walls = input.bool(true, "Combined walls", group="Levels")
show_expiry_walls = input.bool(true, "Selected-expiry walls", group="Levels")
show_flips = input.bool(true, "Γ flips", group="Levels")
show_max_pain = input.bool(true, "Max pain", group="Levels")
show_vanna = input.bool(false, "Vanna magnet", group="Levels")
show_gamma = input.bool(true, "Γ concentrations", group="Levels")
show_delta = input.bool(false, "Δ concentrations", group="Levels")
show_volume_walls = input.bool(true, "Volume walls", group="Levels", tooltip="Walls measured from contracts traded today rather than from open interest. For a same-day expiry this often describes current hedging better than a position built over weeks.")
show_confirmation = input.bool(true, "Confirmation book (QQQ / SPY)", group="Levels", tooltip="Draws the ETF book rescaled onto this chart. Where it agrees with the index book the level is corroborated by a second, independently listed chain.")

show_profile = input.bool(true, "Exposure histogram", group="Overlays", tooltip="The strike-by-strike Γ profile, drawn to the right of price. This is the shape the walls are peaks of.")
profile_source = input.string("Both, back to back", "Histogram source", options=["Both, back to back", "Index book (NDX / SPX)", "Confirmation book (QQQ / SPY)"], group="Overlays", tooltip="Back to back grows the index book left of a shared axis and the ETF right of it, each keeping the bin height its own strike grid earns. Same price is the same height on both sides, so where the two chains agree is readable directly. Overlaying them instead would merge two different bin widths into one shape that is neither.")
profile_bars = input.int(40, "Histogram length (bars)", minval=5, maxval=200, group="Overlays")
show_expected_move = input.bool(true, "Expected move", group="Overlays", tooltip="Front-expiry ATM implied volatility scaled to that expiry's own year fraction, so a 0DTE move is not rounded up to a whole session.")
move_sigmas = input.int(2, "Expected-move bands", minval=1, maxval=3, group="Overlays")
max_levels = input.int(14, "Nearest levels drawn (0 = all)", minval=0, maxval=60, group="Filter", tooltip="Keeps the levels closest to price and drops the rest from the chart.")
max_distance = input.float(3.0, "Maximum distance from price (%, 0 = off)", minval=0.0, step=0.25, group="Filter")
min_weight = input.int(0, "Minimum concentration weight (0-100)", minval=0, maxval=100, group="Filter", tooltip="Drops Γ and Δ clusters below this share of the strongest cluster. Walls, flips and max pain are never filtered by weight.")
hide_outside_rth = input.bool(false, "Draw only during regular hours", group="Filter")
show_warning = input.bool(true, "Warn when the payload cannot be trusted", group="Filter", tooltip="Silent while the payload is sound. A status line that is always on the chart stops being read, so this only appears when the levels are describing something other than the current book: nothing parsed, the snapshot is old, or every dated expiry in it has settled. Age alone cannot catch the last of those — a payload copied at 15:55 is minutes old at 16:05 and its 0DTE walls are already gone.")
stale_hours = input.float(24, "Treat the payload as stale after (hours)", minval=0.5, maxval=336, step=0.5, group="Filter", tooltip="Measured from the snapshot time in the payload header, against the chart's clock. Open interest is published once a session, so a payload that has outlived one is describing a book that has since been traded through.")
settled_mode = input.string("Hide", "Settled expiries", options=["Hide", "Dim", "Draw"], group="Filter", tooltip="A payload is a snapshot that outlives its own contracts. Exported at 15:55 it is only four hours old at 20:00, and passes any freshness test, while its 0DTE walls describe options that stopped existing at the close — the worst read to carry into an overnight session, where the exposure that matters belongs to the next expiry. Each dated wall now travels with the instant its expiry settles and is withdrawn once that passes. Only dated walls carry one; the combined levels span the whole selection.")

// How each book renders. The index book is measured on the chain the chart
// actually tracks, so it draws as a line: a definite price. The ETF book is
// rescaled onto the index, where a $1 QQQ strike grid lands as a ~41-point band
// against the index's own 10,
// so it draws as a zone — the width is the honest precision of the conversion,
// not decoration. Any book can be set to either or both.
index_style = input.string("Line", "Index book (NDX / SPX)", options=["Line", "Zone", "Line + zone"], group="Books")
confirm_style = input.string("Zone", "Confirmation book (QQQ / SPY)", options=["Line", "Zone", "Line + zone"], group="Books")
confirm_recolor = input.bool(true, "Tint the confirmation book", group="Books", tooltip="Off keeps the call/put coloring so an ETF wall reads as a wall; on makes which book a level came from the first thing you see.")
c_confirm = input.color(#6a5f8f, "Confirmation tint", group="Books")

show_zones = input.bool(true, "Draw zones at all", group="Style", tooltip="Master switch. Which books draw zones is set in the Books group.")
zone_width_mult = input.float(1.0, "Zone width in strike increments", minval=0.1, maxval=6.0, step=0.1, group="Style", tooltip="A zone of 1.0 spans exactly one strike increment of the book the level came from, after mapping onto this chart.")
zone_half_width = input.float(0.0, "Zone half-width override (0 = from strikes)", minval=0.0, step=0.25, group="Style")
merge_tolerance = input.float(0.0, "Merge levels within (0 = from zone width)", minval=0.0, step=0.25, group="Style", tooltip="Levels closer together than this are drawn once with their labels combined, which is what stops a wall, a gamma cluster and an expiry wall on the same strike from printing three overlapping lines.")
anchor_snapshot = input.bool(true, "Start lines at the snapshot bar", group="Style", tooltip="Levels measured at the snapshot time did not apply before it. Anchoring there also makes a stale payload obvious: the shorter the line, the fresher the data.")
left_bars = input.int(300, "Bars drawn to the left (when unanchored)", minval=0, maxval=5000, group="Style")
right_bars = input.int(30, "Bars projected to the right", minval=0, maxval=500, group="Style")
extend_right = input.bool(false, "Extend lines indefinitely", group="Style")
stagger_labels = input.bool(true, "Stagger crowded labels", group="Style")
label_lanes = input.int(4, "Label lanes", minval=1, maxval=8, group="Style", tooltip="How many columns crowded labels are allowed to spread across. A run of levels closer together than a label is tall walks sideways through the lanes instead of stacking.")
label_char_bars = input.float(0.8, "Label width per character (bars)", minval=0.2, maxval=4.0, step=0.1, group="Style", tooltip="Lane spacing is the longest caption in the set times this. Text is measured in pixels and lanes in bars, so the conversion depends on horizontal zoom: raise it if labels still overlap, lower it if they sit too far apart.")
label_backdrop = input.bool(true, "Solid label background", group="Style", tooltip="Fills the label with the chart background so a label in front hides the one behind it. Transparent labels let overlapping text mash together into something unreadable.")
show_prices = input.bool(true, "Price in label", group="Style")
c_call = input.color(#2f6b5f, "Call side", group="Style")
c_put = input.color(#a0443b, "Put side", group="Style")
c_flip = input.color(#8a641f, "Γ flip", group="Style")
c_pain = input.color(#6f6378, "Max pain", group="Style")
c_vanna = input.color(#315f78, "Vanna magnet", group="Style")
c_delta = input.color(#4b6ea9, "Δ concentration", group="Style")
c_move = input.color(#7a7f8a, "Expected move", group="Style")
c_stale = input.color(#a0443b, "Payload warning", group="Style")

// Level kinds. Parallel arrays stand in for a record type, which Pine has no
// direct equivalent of.
//   0 call wall    1 put wall     2 gamma flip   3 max pain   4 vanna
//   5 gamma +      6 gamma -      7 delta +      8 delta -
//   9 expiry call 10 expiry put  11 expiry flip
//  12 volume call 13 volume put
var float[] lv_price = array.new_float()
var string[] lv_label = array.new_string()
var int[] lv_kind = array.new_int()
var float[] lv_weight = array.new_float()
var int[] lv_role = array.new_int()
var float[] lv_step = array.new_float()
// When the level's expiry settles, in epoch seconds. Zero means the payload did
// not say, which is treated as no evidence rather than as expired. Only the
// dated walls carry one: the aggregate levels span the whole selection.
var float[] lv_settles = array.new_float()

// The strike-by-strike exposure profile of the primary book.
var float[] hist_strike = array.new_float()
var float[] hist_value = array.new_float()
// Which book each histogram point came from: 0 the index chain, 1 the ETF.
var int[] hist_book = array.new_int()
// Strike increment per book, which sets how tall a histogram bar is drawn.
var float[] book_step = array.new_float(2, na)
var string[] book_name = array.new_string(2, "")

var bool parsed = false
var bool payload_is_futures = false
var bool payload_is_stock = false
var bool payload_is_mixed = false
var float payload_ref = 0.0
var float payload_epoch = 0.0
var float payload_warn_after = 0.0

// Pine functions may mutate a global array by reference but may not assign to a
// global scalar, so the values the block parser has to hand back live here.
//   0 one-sigma bps  1 primary spot  2 front-expiry settlement, epoch seconds
var float[] meta_levels = array.new_float(3, na)

f_str(items, index) =>
    array.size(items) > index ? array.get(items, index) : ""

// Prices are never legitimately zero, so an empty or zero field means absent.
f_price(items, index) =>
    value = str.tonumber(str.trim(f_str(items, index)))
    na(value) or value == 0 ? float(na) : value

f_number(items, index) =>
    value = str.tonumber(str.trim(f_str(items, index)))
    na(value) ? 0.0 : value

// settles travels with every level, zero where the payload has nothing to say,
// so lv_settles stays the same length as the arrays beside it.
f_push(price, text_value, kind, weight, role, step, settles) =>
    if not na(price)
        array.push(lv_price, price)
        array.push(lv_label, text_value)
        array.push(lv_kind, kind)
        array.push(lv_weight, weight)
        array.push(lv_role, role)
        array.push(lv_step, step)
        array.push(lv_settles, settles)

f_add_concentrations(raw, kind_positive, kind_negative, name_positive, name_negative, prefix, role, step) =>
    records = str.split(raw, ";")
    int positive_rank = 0
    int negative_rank = 0
    if array.size(records) > 0
        for record_index = 0 to array.size(records) - 1
            fields = str.split(array.get(records, record_index), ",")
            if array.size(fields) >= 3
                price = f_price(fields, 0)
                weight = f_number(fields, 1) / 100.0
                sign = f_number(fields, 2)
                if not na(price)
                    if sign >= 0
                        positive_rank := positive_rank + 1
                        f_push(price, prefix + name_positive + str.tostring(positive_rank), kind_positive, weight, role, step, 0.0)
                    else
                        negative_rank := negative_rank + 1
                        f_push(price, prefix + name_negative + str.tostring(negative_rank), kind_negative, weight, role, step, 0.0)

f_parse_block(block) =>
    fields = str.split(block, "~")
    if array.size(fields) >= 8
        name = f_str(fields, 0)
        role = f_str(fields, 1) == "C" ? 1 : 0
        step = f_number(fields, 3)
        // Every level says which book measured it, the index one included.
        prefix = name + " "

        array.set(book_step, role, step)
        array.set(book_name, role, name)

        aggregate = str.split(f_str(fields, 4), ",")
        call_wall = f_price(aggregate, 0)
        put_wall = f_price(aggregate, 1)
        flip = f_price(aggregate, 2)
        if role == 0
            array.set(meta_levels, 1, f_price(fields, 2))
        // The aggregate levels span the whole selection, so no single settlement
        // instant describes them and they are never withdrawn on this test.
        f_push(call_wall, prefix + "Call Wall", 0, 1.0, role, step, 0.0)
        f_push(put_wall, prefix + "Put Wall", 1, 1.0, role, step, 0.0)
        f_push(flip, prefix + "Γ Flip", 2, 1.0, role, step, 0.0)
        f_push(f_price(aggregate, 3), prefix + "Max Pain", 3, 1.0, role, step, 0.0)
        f_push(f_price(aggregate, 4), prefix + "Vanna Magnet", 4, 1.0, role, step, 0.0)

        f_add_concentrations(f_str(fields, 5), 5, 6, "Γ+", "Γ−", prefix, role, step)
        f_add_concentrations(f_str(fields, 6), 7, 8, "Δ+", "Δ−", prefix, role, step)

        expiries = str.split(f_str(fields, 7), ";")
        if array.size(expiries) > 0
            for expiry_index = 0 to array.size(expiries) - 1
                slice = str.split(array.get(expiries, expiry_index), ",")
                if array.size(slice) >= 4
                    label_text = prefix + f_str(slice, 0)
                    // Near expiries carry the hedging that matters today, so a
                    // dated wall is drawn progressively fainter and thinner.
                    dte = array.size(slice) >= 5 ? f_number(slice, 4) : 0.0
                    weight = math.max(0.3, 1.0 - dte / 30.0)
                    // When this expiry settles. Days to expiry cannot stand in:
                    // a 0DTE wall is weighted 1.0 — the boldest line drawn — for
                    // hours after the contracts behind it have ceased to exist.
                    settles = array.size(slice) >= 6 ? f_number(slice, 5) : 0.0
                    f_push(f_price(slice, 1), label_text + " Call Wall", 9, weight, role, step, settles)
                    f_push(f_price(slice, 2), label_text + " Put Wall", 10, weight, role, step, settles)
                    f_push(f_price(slice, 3), label_text + " Γ Flip", 11, weight, role, step, settles)

        // Both books carry a profile; the drawing picks one.
        if array.size(fields) >= 9
            points = str.split(f_str(fields, 8), ";")
            if array.size(points) > 0
                for point_index = 0 to array.size(points) - 1
                    point = str.split(array.get(points, point_index), ",")
                    if array.size(point) >= 2
                        strike = f_price(point, 0)
                        exposure = f_number(point, 1)
                        if not na(strike) and exposure != 0
                            array.push(hist_strike, strike)
                            array.push(hist_value, exposure)
                            array.push(hist_book, role)

        if array.size(fields) >= 10
            volume = str.split(f_str(fields, 9), ",")
            f_push(f_price(volume, 0), prefix + "Volume Call Wall", 12, 1.0, role, step, 0.0)
            f_push(f_price(volume, 1), prefix + "Volume Put Wall", 13, 1.0, role, step, 0.0)

        if role == 0 and array.size(fields) >= 11
            move = str.split(f_str(fields, 10), ",")
            array.set(meta_levels, 0, f_number(move, 0))
            // The band is one standard deviation of the front expiry's own
            // implied volatility, so once that expiry settles it is a range for
            // a contract that no longer trades. This subfield was the front
            // expiry's days to expiry, which nothing read.
            array.set(meta_levels, 2, f_number(move, 1))

// Parsed once. Any change to the payload input recompiles the whole script, so
// there is nothing to invalidate.
if not parsed
    parsed := true
    if str.startswith(bridge, "GX2#")
        blocks = str.split(str.substring(bridge, 4), "|")
        header = str.split(f_str(blocks, 0), "~")
        payload_is_futures := f_str(header, 1) == "F"
        payload_is_stock := f_str(header, 2) == "STOCK"
        payload_is_mixed := f_str(header, 2) == "MIXED"
        payload_ref := f_number(header, 3)
        payload_epoch := f_number(header, 4)
        payload_warn_after := f_number(header, 5)
        if array.size(blocks) > 1
            for block_index = 1 to array.size(blocks) - 1
                f_parse_block(array.get(blocks, block_index))

// The payload names the instrument it was built for, which selects the cash
// index without asking the user. str.contains over the input keeps the result
// simple-qualified so request.security still accepts the symbol.
is_nasdaq = str.contains(bridge, "~NQ~")
cash_symbol = is_nasdaq ? ndx_symbol : spx_symbol
// Extended hours on the cash leg. An index-to-futures ratio is only meaningful
// when both legs are quoting, and asking for the regular session alone leaves
// the secondary series with a fraction of this chart's bars, which is what
// widens the offset Pine has to reach back through.
cash_close = request.security(ticker.modify(cash_symbol, session.extended), timeframe.period, close, gaps=barmerge.gaps_on, lookahead=barmerge.lookahead_off)

// Sampled live, and only on bars where the cash leg actually printed.
//
// The ratio has to track the market rather than a fixed reference: it is the
// live relationship between the two instruments, and a level converted through
// a stale one drifts away from where it belongs. Sampling only synchronized
// bars is what keeps it honest — comparing a moving futures price against a
// frozen index would fold the futures' own move into the ratio and push every
// level in the direction price just went.
//
// Outside the cash session no synchronized sample exists, so the last good
// ratio is held rather than recomputed against a stale index print.
var float[] ratio_window = array.new_float()
var float[] basis_window = array.new_float()
var float held_ratio = na
var float held_basis = na
if not na(cash_close) and cash_close > 0
    array.push(ratio_window, close / cash_close)
    array.push(basis_window, close - cash_close)
    if array.size(ratio_window) > map_samples
        array.shift(ratio_window)
        array.shift(basis_window)
    held_ratio := array.avg(ratio_window)
    held_basis := array.avg(basis_window)

// The last bar at or before the snapshot. Levels measured then did not apply to
// the price action before it, so that is where their lines begin.
var int snapshot_bar = 0
if payload_epoch > 0 and time <= payload_epoch * 1000
    snapshot_bar := bar_index
// How far this chart trades from the payload's own reference price. Near 1 the
// chart is already in the payload's price space and nothing needs mapping;
// around 0.024 it is the ETF, around 1.005 the front future.
reference_gap = payload_ref > 0 ? math.abs(close / payload_ref - 1) : float(na)
chart_ticker = str.upper(syminfo.ticker)
chart_is_futures = str.contains(chart_ticker, "NQ") or str.contains(chart_ticker, "ES")
auto_mode = (payload_is_stock or (payload_is_mixed and not chart_is_futures)) ? "None" : payload_is_futures ? (na(reference_gap) or reference_gap < 0.10 ? "None" : "Payload-reference ratio") : (na(held_ratio) ? (payload_ref > 0 ? "Payload-reference ratio" : "None") : "Cash-index ratio")
active_mode = map_mode == "Auto" ? auto_mode : map_mode

float map_factor = 1.0
float map_offset = 0.0
if active_mode == "Cash-index ratio"
    map_factor := held_ratio
else if active_mode == "Cash-index basis"
    map_offset := held_basis
else if active_mode == "Payload-reference ratio"
    map_factor := payload_ref > 0 ? close / payload_ref : float(na)
else if active_mode == "Manual ratio"
    map_factor := manual_ratio_input
else if active_mode == "Manual basis"
    map_offset := manual_basis_input

f_map(price) =>
    na(price) or na(map_factor) or na(map_offset) ? float(na) : math.round_to_mintick(price * map_factor + map_offset)

// Widths scale with the ratio but never take the additive basis: a basis shifts
// where a level sits, it does not stretch how wide the strike grid is.
f_map_width(width) =>
    na(width) or na(map_factor) ? float(na) : width * map_factor

f_priority(kind) =>
    kind == 0 or kind == 1 ? 0 : kind == 2 ? 1 : kind == 5 or kind == 6 ? 2 : kind == 12 or kind == 13 ? 2 : kind == 9 or kind == 10 ? 3 : kind == 11 ? 4 : kind == 3 ? 5 : kind == 4 ? 6 : 7

f_color(kind) =>
    kind == 0 or kind == 5 or kind == 9 or kind == 12 ? c_call : kind == 1 or kind == 6 or kind == 10 or kind == 13 ? c_put : kind == 2 or kind == 11 ? c_flip : kind == 3 ? c_pain : kind == 4 ? c_vanna : c_delta

f_visible(kind) =>
    kind == 0 or kind == 1 ? show_aggregate_walls : kind == 2 or kind == 11 ? show_flips : kind == 3 ? show_max_pain : kind == 4 ? show_vanna : kind == 5 or kind == 6 ? show_gamma : kind == 7 or kind == 8 ? show_delta : kind == 12 or kind == 13 ? show_volume_walls : show_expiry_walls

f_weight_filtered(kind, weight) =>
    (kind >= 5 and kind <= 8) and weight * 100 < min_weight

// Has this level's expiry settled? Zero means the payload did not say, which is
// no evidence rather than evidence of expiry, so the level stays. The comparison
// is against the chart's own clock, because whether a contract exists is a fact
// about now and not about when the snapshot was taken.
f_settled(settles) =>
    settles > 0 and timenow >= settles * 1000

// Which book a level belongs to: 0 the index chain, 1 the confirmation chain.
// Style, colour and emphasis all follow from this.
f_class(kind, role) =>
    role == 1 ? 1 : 0

f_class_style(book) =>
    book == 0 ? index_style : confirm_style

f_has_line(book) =>
    style = f_class_style(book)
    style == "Line" or style == "Line + zone"

f_has_zone(book) =>
    style = f_class_style(book)
    style == "Zone" or style == "Line + zone"

// The index book keeps the call/put colouring, because there a wall should read
// as a wall. A level only the ETF produced takes that book's tint, so where it
// came from is the first thing you see.
f_tone(kind, from_index, from_confirm) =>
    from_index or not from_confirm ? f_color(kind) : confirm_recolor ? c_confirm : f_color(kind)

f_half_width(step) =>
    base = zone_half_width > 0 ? zone_half_width : nz(f_map_width(step), 0) * zone_width_mult / 2
    math.max(base, syminfo.mintick)

// Roughly how far apart two labels have to be before they stop overlapping.
// Derived from the recent range because Pine cannot see the pixel scale.
// ta.* has to run on every bar or its window is wrong, so the recent extremes
// are taken here rather than inside the drawing block that consumes them.
chart_high = ta.highest(high, 200)
label_gap = (chart_high - ta.lowest(low, 200)) / 28

var line[] drawn_lines = array.new_line()
var box[] drawn_boxes = array.new_box()
var label[] drawn_labels = array.new_label()

f_clear() =>
    while array.size(drawn_lines) > 0
        line.delete(array.pop(drawn_lines))
    while array.size(drawn_boxes) > 0
        box.delete(array.pop(drawn_boxes))
    while array.size(drawn_labels) > 0
        label.delete(array.pop(drawn_labels))

// Merged levels, rebuilt on every redraw.
var float[] merged_price = array.new_float()
var string[] merged_label = array.new_string()
var int[] merged_kind = array.new_int()
var float[] merged_half = array.new_float()
var float[] merged_weight = array.new_float()
// Which books contributed to a merged level. Kept as three flags rather than a
// bitmask because Pine has no bitwise operators.
var bool[] merged_index = array.new_bool()
var bool[] merged_confirm = array.new_bool()
var bool[] merged_agreed = array.new_bool()
var int[] merged_slot = array.new_int()
// Whether every level in the group has settled. A group holding one live member
// is live, so a dated wall merged onto a combined wall is not withdrawn.
var bool[] merged_settled = array.new_bool()

// Histogram layout, resolved before the levels draw because their labels sit to
// the right of it and have to clear whatever width it takes.
var bool profile_both = false
var int profile_shown = 0
var int profile_lanes = 1

// Bars between label lanes, derived from the longest caption actually in the
// set rather than fixed, so the stagger clears the text beside it.
var int label_pitch = 10

f_emit(price, text_value, kind, half, weight, from_index, from_confirm, settled) =>
    array.push(merged_price, price)
    array.push(merged_label, text_value)
    array.push(merged_kind, kind)
    array.push(merged_half, half)
    array.push(merged_weight, weight)
    array.push(merged_index, from_index)
    array.push(merged_confirm, from_confirm)
    array.push(merged_settled, settled)

f_left_edge() =>
    anchor_snapshot and snapshot_bar > 0 ? snapshot_bar : math.max(bar_index - left_bars, 0)

// Pine refuses to place a drawing more than 500 bars past the last one, and the
// projection, the histogram and the label stagger all push to the right.
f_future(offset) =>
    bar_index + math.min(offset, 500)

f_render(index) =>
    price = array.get(merged_price, index)
    kind = array.get(merged_kind, index)
    half = array.get(merged_half, index)
    weight = array.get(merged_weight, index)
    from_index = array.get(merged_index, index)
    from_confirm = array.get(merged_confirm, index)
    agreed = array.get(merged_agreed, index)
    settled = array.get(merged_settled, index)
    // A merged level draws whatever any of its contributing books asks for, so
    // an index line and an ETF zone on the same price render as a line inside
    // its confirmation band rather than one of the two silently winning.
    wants_line = (from_index and f_has_line(0)) or (from_confirm and f_has_line(1))
    draw_zone = show_zones and half > 0 and ((from_index and f_has_zone(0)) or (from_confirm and f_has_zone(1)))
    // A zone-only book must not disappear when zones are switched off globally;
    // it falls back to a line so the level is still on the chart.
    draw_line = wants_line or not draw_zone
    if draw_line or draw_zone
        tone = f_tone(kind, from_index, from_confirm)
        // Dim draws a settled level as faintly as the ETF book and never bolds
        // it, because whatever weight its days to expiry earned it, the contracts
        // behind it are gone. Draw keeps its full weight, for reading back where
        // a wall stood. Either way the caption says so: that is a fact about the
        // level, not a rendering preference.
        faded = settled and settled_mode == "Dim"
        dim = not from_index or faded
        structural = f_priority(kind) <= 1 and not faded
        thickness = faded ? 1 : (structural or weight >= 0.66 ? 2 : 1) + (agreed ? 1 : 0)
        left_edge = f_left_edge()
        right_edge = f_future(right_bars)
        if draw_zone
            array.push(drawn_boxes, box.new(
              left=left_edge,
              top=price + half,
              right=right_edge,
              bottom=price - half,
              extend=extend_right ? extend.right : extend.none,
              border_color=color.new(tone, dim ? 70 : 60),
              bgcolor=color.new(tone, dim ? 93 : math.round(88 - weight * 8))))
        if draw_line
            array.push(drawn_lines, line.new(
              x1=left_edge,
              y1=price,
              x2=right_edge,
              y2=price,
              color=dim ? color.new(tone, 45) : tone,
              width=thickness,
              extend=extend_right ? extend.right : extend.none,
              style=dim ? line.style_dashed : structural ? line.style_solid : line.style_dotted))
        // Said outright rather than left to the reader to infer from a thinner
        // line: a level whose contracts have settled is not a weak level.
        caption = (agreed ? "✓ " : "") + array.get(merged_label, index) +
          (settled ? " (settled)" : "") +
          (show_prices ? "  " + str.tostring(price, format.mintick) : "")
        array.push(drawn_labels, label.new(
          x=f_future(right_bars + 2 + (show_profile ? profile_bars * profile_lanes + 3 : 0) + array.get(merged_slot, index) * label_pitch),
          y=price,
          text=caption,
          style=label.style_label_left,
          color=label_backdrop ? color.new(chart.bg_color, 10) : color.new(tone, 100),
          textcolor=dim ? color.new(tone, 25) : tone,
          size=size.small))

// visible_price and visible_source are locals of the drawing block, and a Pine
// function can only reach globals, so they are handed in rather than captured.
f_merge_book(by_price, visible_price, visible_source, book_pass) =>
    bool group_open = false
    float group_price = 0.0
    float group_anchor = 0.0
    string group_text = ""
    int group_kind = 0
    int group_priority = 99
    float group_half = 0.0
    float group_weight = 0.0
    bool group_settled = false
    for rank = 0 to array.size(by_price) - 1
        slot = array.get(by_price, rank)
        price = array.get(visible_price, slot)
        source_index = array.get(visible_source, slot)
        kind = array.get(lv_kind, source_index)
        role = array.get(lv_role, source_index)
        if f_class(kind, role) == book_pass
            priority = f_priority(kind)
            half = f_half_width(array.get(lv_step, source_index))
            weight = array.get(lv_weight, source_index)
            settled = f_settled(array.get(lv_settles, source_index))
            tolerance = merge_tolerance > 0 ? merge_tolerance : group_half * 1.2
            if group_open and price - group_anchor > tolerance
                f_emit(group_price, group_text, group_kind, group_half, group_weight, book_pass == 0, book_pass == 1, group_settled)
                group_open := false
            if not group_open
                group_open := true
                group_anchor := price
                group_price := price
                group_text := array.get(lv_label, source_index)
                group_kind := kind
                group_priority := priority
                group_half := half
                group_weight := weight
                group_settled := settled
            else
                group_text := group_text + "  ·  " + array.get(lv_label, source_index)
                group_half := math.max(group_half, half)
                group_weight := math.max(group_weight, weight)
                // One live member keeps the whole group live: a dated wall that
                // has settled onto a combined wall that has not is still a price
                // the combined book is holding.
                group_settled := group_settled and settled
                if priority < group_priority
                    group_priority := priority
                    group_kind := kind
                    group_price := price
    if group_open
        f_emit(group_price, group_text, group_kind, group_half, group_weight, book_pass == 0, book_pass == 1, group_settled)

// Redraw on every realtime tick. A realtime tick rolls the script back to the
// start of the bar, which destroys anything drawn on the previous tick, so the
// levels have to be recreated rather than drawn once when the bar opens.
if barstate.islast
    f_clear()
    array.clear(merged_price)
    array.clear(merged_label)
    array.clear(merged_kind)
    array.clear(merged_half)
    array.clear(merged_weight)
    array.clear(merged_index)
    array.clear(merged_confirm)
    array.clear(merged_agreed)
    array.clear(merged_slot)
    array.clear(merged_settled)

    drawing = not hide_outside_rth or session.ismarket

    // Which books actually shipped a profile. A single-book selection falls
    // back to whichever one did, and back to back needs both to mean anything.
    bool has_index = false
    bool has_confirm = false
    if array.size(hist_book) > 0
        for point_index = 0 to array.size(hist_book) - 1
            if array.get(hist_book, point_index) == 0
                has_index := true
            else
                has_confirm := true
    profile_both := profile_source == "Both, back to back" and has_index and has_confirm
    wanted = profile_source == "Confirmation book (QQQ / SPY)" ? 1 : 0
    profile_shown := wanted == 0 ? (has_index ? 0 : 1) : (has_confirm ? 1 : 0)
    profile_lanes := show_profile and profile_both ? 2 : 1

    visible_price = array.new_float()
    visible_source = array.new_int()
    if array.size(lv_price) > 0 and drawing
        for source_index = 0 to array.size(lv_price) - 1
            kind = array.get(lv_kind, source_index)
            role = array.get(lv_role, source_index)
            weight = array.get(lv_weight, source_index)
            settled = f_settled(array.get(lv_settles, source_index))
            label_text = array.get(lv_label, source_index)
            // A MIXED payload deliberately contains futures and watchlist books.
            // Keep only the source that belongs to the chart under the study.
            // The source name prefixes every label in the bridge format.
            matches_chart = payload_is_stock ? str.startswith(label_text, chart_ticker + " ") : not payload_is_mixed ? true : str.contains(chart_ticker, "NQ") ? (str.startswith(label_text, "NDX ") or str.startswith(label_text, "QQQ ")) : str.contains(chart_ticker, "ES") ? (str.startswith(label_text, "SPX ") or str.startswith(label_text, "SPY ")) : str.startswith(label_text, chart_ticker + " ")
            if matches_chart and f_visible(kind) and (role == 0 or show_confirmation) and not f_weight_filtered(kind, weight) and not (settled and settled_mode == "Hide")
                mapped = f_map(array.get(lv_price, source_index))
                if not na(mapped) and (max_distance <= 0 or (close > 0 and math.abs(mapped / close - 1) * 100 <= max_distance))
                    array.push(visible_price, mapped)
                    array.push(visible_source, source_index)

    // Collapse levels that land on the same price into one line with a combined
    // label. Without this a combined wall, a gamma cluster and the 0DTE wall on
    // the same strike print three lines a tick apart and read as three levels.
    // A group holding both books is flagged: two independently listed chains
    // agreeing on a price is the strongest read the payload can offer.
    if array.size(visible_price) > 0
        by_price = array.sort_indices(visible_price, order.ascending)
        // One pass per book. Merging across books used to take the price of the
        // higher-priority member and the width of the widest, which drew an
        // ETF-width zone centred on an index price: off its own strike grid and
        // away from its own histogram bar by up to half a bin.
        for book_pass = 0 to 1
            f_merge_book(by_price, visible_price, visible_source, book_pass)

    total = array.size(merged_price)
    if total > 0
        for index = 0 to total - 1
            array.push(merged_slot, 0)
            array.push(merged_agreed, false)

        // Agreement is proximity between the books, not a merge. Marking both
        // levels leaves each on its own strike grid and its own histogram bar,
        // and an index line sitting inside the ETF band it agrees with is a
        // better picture of corroboration than one line standing for both.
        for left = 0 to total - 1
            if array.get(merged_index, left)
                for right = 0 to total - 1
                    if array.get(merged_confirm, right)
                        reach = math.max(array.get(merged_half, left), array.get(merged_half, right))
                        if math.abs(array.get(merged_price, left) - array.get(merged_price, right)) <= reach
                            array.set(merged_agreed, left, true)
                            array.set(merged_agreed, right, true)

    distances = array.new_float()
    if total > 0
        for index = 0 to total - 1
            array.push(distances, math.abs(array.get(merged_price, index) - close))
    nearest = total > 0 ? array.sort_indices(distances, order.ascending) : array.new_int()
    drawn = max_levels > 0 ? math.min(max_levels, total) : total
    if drawn > 0
        // Lanes are assigned over the levels that survive the nearest-N cut, in
        // price order. Reserving a lane for a level that never draws would push
        // its neighbours sideways for nothing.
        keeps = array.new_bool(total, false)
        for rank = 0 to drawn - 1
            array.set(keeps, array.get(nearest, rank), true)

        // Lane pitch comes from the longest caption in the set. A fixed step
        // narrower than the text is what let a crowded run overlap even when it
        // was staggered: four lanes nine bars apart is one label's width.
        int widest = 0
        for index = 0 to total - 1
            if array.get(keeps, index)
                chars = str.length(array.get(merged_label, index)) + (show_prices ? 12 : 0) + 4
                widest := chars > widest ? chars : widest
        label_pitch := math.max(6, math.round(widest * label_char_bars))

        // First lane whose last label sits at least a label's height below this
        // one. Walking price ascending means a lane is free as soon as the run
        // that filled it has been cleared, so an isolated level returns to lane 0.
        lane_price = array.new_float(label_lanes, -1e18)
        by_merged = array.sort_indices(merged_price, order.ascending)
        for rank = 0 to total - 1
            index = array.get(by_merged, rank)
            if array.get(keeps, index)
                price = array.get(merged_price, index)
                int lane = 0
                if stagger_labels and label_gap > 0
                    lane := -1
                    for candidate = 0 to label_lanes - 1
                        if lane < 0 and price - array.get(lane_price, candidate) >= label_gap
                            lane := candidate
                    // Every lane still occupied within a label's height. Take the
                    // one holding the lowest label, the one this is furthest from.
                    if lane < 0
                        lane := array.indexof(lane_price, array.min(lane_price))
                array.set(lane_price, lane, price)
                array.set(merged_slot, index, lane)

        for rank = 0 to drawn - 1
            f_render(array.get(nearest, rank))

    // The exposure histogram: the distribution the walls are the peaks of. A
    // level with a broad shoulder behind it is a different proposition from an
    // isolated spike, and the lines alone cannot say which is which.
    if show_profile and drawing and array.size(hist_strike) > 0
        wanted = profile_source == "Index book (NDX / SPX)" ? 0 : 1
        // Fall back to whichever book did ship a profile, so excluding one from
        // the bridge leaves the histogram working rather than blank.
        // Back to back puts the axis a lane in, so the index book has somewhere
        // to grow leftwards into. A single book grows right from the near edge.
        axis = f_future(right_bars + 2 + (profile_both ? profile_bars : 0))
        float highest_level = na
        float lowest_level = na
        for point_index = 0 to array.size(hist_strike) - 1
            book = array.get(hist_book, point_index)
            if profile_both or book == profile_shown
                level = f_map(array.get(hist_strike, point_index))
                exposure = array.get(hist_value, point_index)
                if not na(level)
                    // Each book keeps the bin height its own strike grid earns,
                    // which is the whole reason the two are drawn apart: an ETF
                    // bar covering ~41 index points is not the same read as an
                    // index bar covering 10, and stacking them would imply it.
                    // A full half-increment, so bins tile with no gap and a zone
                    // at the default width is exactly one bin tall. A hairline
                    // gap here made a wall's zone look mismatched against the bar
                    // it was measured from.
                    half = math.max(nz(f_map_width(array.get(book_step, book)), 0) * 0.5, syminfo.mintick)
                    tone = exposure > 0 ? c_call : c_put
                    length = math.max(1, math.round(math.abs(exposure) / 100 * profile_bars))
                    grows_left = profile_both and book == 0
                    array.push(drawn_boxes, box.new(
                      left=math.max(grows_left ? axis - length : axis, bar_index + 1),
                      top=level + half,
                      right=math.min(grows_left ? axis : axis + length, bar_index + 500),
                      bottom=level - half,
                      border_color=color.new(tone, 75),
                      bgcolor=color.new(tone, 55)))
                    highest_level := na(highest_level) or level > highest_level ? level : highest_level
                    lowest_level := na(lowest_level) or level < lowest_level ? level : lowest_level
        if profile_both and not na(highest_level)
            array.push(drawn_lines, line.new(
              x1=axis,
              y1=lowest_level,
              x2=axis,
              y2=highest_level,
              color=color.new(color.gray, 45),
              width=1))
            array.push(drawn_labels, label.new(
              x=axis,
              y=highest_level,
              text="◄ " + array.get(book_name, 0) + "   " + array.get(book_name, 1) + " ►",
              style=label.style_label_down,
              color=color.new(color.gray, 100),
              textcolor=color.new(color.gray, 20),
              size=size.tiny))

    // Expected move. The walls say where hedging sits; this says whether today
    // has the volatility to reach them.
    sigma_bps = array.get(meta_levels, 0)
    move_anchor = f_map(array.get(meta_levels, 1))
    // The band is one standard deviation of the front expiry's own implied
    // volatility. Once that expiry settles it is the expected range of a contract
    // that no longer trades, so it is withdrawn on the same test as a dated wall
    // rather than left implying the next session will respect it.
    move_settled = f_settled(nz(array.get(meta_levels, 2), 0))
    if show_expected_move and drawing and not move_settled and not na(move_anchor) and not na(sigma_bps) and sigma_bps > 0
        for band = 1 to move_sigmas
            reach = move_anchor * (sigma_bps / 10000.0) * band
            for direction = 0 to 1
                level = direction == 0 ? move_anchor + reach : move_anchor - reach
                array.push(drawn_lines, line.new(
                  x1=f_left_edge(),
                  y1=level,
                  x2=f_future(right_bars),
                  y2=level,
                  color=color.new(c_move, 30 + band * 15),
                  width=1,
                  style=line.style_dashed))
                array.push(drawn_labels, label.new(
                  x=f_future(right_bars + 2),
                  y=level,
                  text=(direction == 0 ? "+" : "−") + str.tostring(band) + "σ",
                  style=label.style_label_left,
                  color=color.new(c_move, 100),
                  textcolor=color.new(c_move, 20),
                  size=size.tiny))

    // Whether the payload can be trusted, said only when it cannot.
    //
    // Three failures, and no one of them implies the others. A malformed paste
    // draws an empty chart and gives no reason for it. An old snapshot has every
    // level measured against a book that has since been traded through, and
    // nothing on the chart says so once the lines are extended. A payload whose
    // dated expiries have all settled can be minutes old and still describe
    // options that no longer exist, which is why age cannot stand in for it.
    if show_warning
        string warning = ""
        if str.length(bridge) > 0 and not str.startswith(bridge, "GX2#")
            warning := "BRIDGE NOT RECOGNISED · EXPECTED A GX2 PAYLOAD"
        else
            // Only the dated walls can settle, and the book is finished only when
            // every one of them has. One live expiry means the payload still
            // describes something that trades.
            int dated_total = 0
            int dated_settled = 0
            if array.size(lv_price) > 0
                for source_index = 0 to array.size(lv_price) - 1
                    dated_kind = array.get(lv_kind, source_index)
                    if dated_kind >= 9 and dated_kind <= 11
                        dated_total := dated_total + 1
                        if f_settled(array.get(lv_settles, source_index))
                            dated_settled := dated_settled + 1
            age_hours = payload_epoch > 0 ? (timenow - payload_epoch * 1000) / 3600000.0 : na
            reasons = array.new_string()
            age_warning_due = payload_warn_after <= 0 or timenow >= payload_warn_after * 1000
            if not na(age_hours) and age_hours > stale_hours and age_warning_due
                // "#" so a whole number of hours prints without a decimal tail.
                array.push(reasons, "SNAPSHOT " + (age_hours < 48 ? str.tostring(age_hours, "#") + "H" : str.tostring(age_hours / 24, "#") + "D") + " OLD")
            if dated_total > 0 and dated_settled == dated_total
                array.push(reasons, "EVERY DATED EXPIRY HAS SETTLED")
            if array.size(reasons) > 0
                warning := array.join(reasons, "  ·  ")
        if str.length(warning) > 0
            // Above the highest level drawn, falling back to the recent range on
            // a payload that produced none, so the warning is wherever the chart
            // is actually looking.
            float warn_at = chart_high
            if array.size(merged_price) > 0
                warn_at := math.max(warn_at, array.max(merged_price))
            array.push(drawn_labels, label.new(
              x=f_future(right_bars + 2),
              y=warn_at,
              text=warning,
              style=label.style_label_left,
              color=color.new(c_stale, 88),
              textcolor=c_stale,
              size=size.small))
`;
