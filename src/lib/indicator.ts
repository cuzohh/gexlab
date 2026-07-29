export const PINE_SCRIPT = String.raw`//@version=6
indicator("GEXLab V3 Option Levels", overlay=true, max_bars_back=1000, max_boxes_count=500, max_lines_count=500, max_labels_count=500)

// Paste the "GX2" bridge payload copied from GEXLab V3.
//
//   GX2#H~<space>~<instrument>~<refSpot>~<epochSec>|<block>|<block>
//   block: <name>~<role>~<spot>~<step>~<agg>~<gamma>~<delta>~<expiries>
//          ~<profile>~<volume>~<move>~<prior>
//     role      P primary book, C confirmation book (QQQ / SPY)
//     step      that book's strike increment, already rescaled onto refSpot
//     agg       call,put,flip,maxpain,vanna
//     gamma     strike,weight,sign;…   weight 0-100, sign +1 / -1
//     delta     strike,weight,sign;…
//     expiries  label,call,put,flip,dte;…
//     profile   strike,exposure;…      exposure -100…100 of the peak
//     volume    callVolumeWall,putVolumeWall
//     move      oneSigmaBps,frontDte
//     prior     priorCall,priorPut,priorFlip
//
// Every block carries its own strike increment, so a QQQ level whose strikes are
// $1 apart draws a zone roughly 41 index points wide while an NDX level draws
// 25, and both are rescaled again by whatever maps the payload onto this chart.
bridge = input.text_area("", "GEXLab bridge", group="Data", tooltip="Copy the bridge from the GEXLab Options workspace. The payload carries its own price space, strike increments and snapshot time.")

map_mode = input.string("Auto", "Chart mapping", options=["Auto", "Cash-index ratio", "Cash-index basis", "Payload-reference ratio", "Manual ratio", "Manual basis", "None"], group="Mapping", tooltip="Auto uses the live cash-index ratio when it is available, which maps the payload onto futures, the cash index itself and the ETF alike. These are observed estimates, not exchange-defined conversions.")
map_samples = input.int(3, "Synchronized sessions", minval=1, maxval=60, group="Mapping", tooltip="Averages the last N daily closes on which the cash index and this chart both printed. Keep it short: these are sessions, not bars, and a futures basis decays toward expiry, so a long average trails the real relationship by more than it smooths. Twenty sessions of NQ carry is worth tens of index points.")
ndx_symbol = input.symbol("NASDAQ:NDX", "NDX cash index", group="Mapping")
spx_symbol = input.symbol("SP:SPX", "SPX cash index", group="Mapping")
manual_ratio_input = input.float(1.0, "Manual ratio", minval=0.000001, step=0.00001, group="Mapping")
manual_basis_input = input.float(0.0, "Manual basis", step=0.25, group="Mapping")

show_aggregate_walls = input.bool(true, "Combined walls", group="Levels")
show_expiry_walls = input.bool(true, "Selected-expiry walls", group="Levels")
show_flips = input.bool(true, "Gamma flips", group="Levels")
show_max_pain = input.bool(true, "Max pain", group="Levels")
show_vanna = input.bool(false, "Vanna magnet", group="Levels")
show_gamma = input.bool(true, "Gamma concentrations", group="Levels")
show_delta = input.bool(false, "Delta concentrations", group="Levels")
show_volume_walls = input.bool(true, "Volume walls", group="Levels", tooltip="Walls measured from contracts traded today rather than from open interest. For a same-day expiry this often describes current hedging better than a position built over weeks.")
show_prior = input.bool(true, "Prior-session walls", group="Levels", tooltip="Where the same walls sat on the previous session's chain. A wall that rolled overnight is a different market from one that has been pinned.")
show_confirmation = input.bool(true, "Confirmation book (QQQ / SPY)", group="Levels", tooltip="Draws the ETF book rescaled onto this chart. Where it agrees with the index book the level is corroborated by a second, independently listed chain.")

show_profile = input.bool(true, "Exposure histogram", group="Overlays", tooltip="The strike-by-strike gamma profile, drawn to the right of price. This is the shape the walls are peaks of.")
profile_bars = input.int(40, "Histogram length (bars)", minval=5, maxval=200, group="Overlays")
show_expected_move = input.bool(true, "Expected move", group="Overlays", tooltip="Front-expiry ATM implied volatility scaled to that expiry's own year fraction, so a 0DTE move is not rounded up to a whole session.")
move_sigmas = input.int(2, "Expected-move bands", minval=1, maxval=3, group="Overlays")
show_regime = input.bool(true, "Gamma regime shading", group="Overlays", tooltip="Tints the background by which side of the gamma flip price is on: above it dealer hedging dampens moves, below it amplifies them.")
regime_transparency = input.int(93, "Regime shading transparency", minval=70, maxval=99, group="Overlays")

max_levels = input.int(14, "Nearest levels drawn (0 = all)", minval=0, maxval=60, group="Filter", tooltip="Keeps the levels closest to price. The rest are still parsed and still appear in the level table.")
max_distance = input.float(3.0, "Maximum distance from price (%, 0 = off)", minval=0.0, step=0.25, group="Filter")
min_weight = input.int(0, "Minimum concentration weight (0-100)", minval=0, maxval=100, group="Filter", tooltip="Drops gamma and delta clusters below this share of the strongest cluster. Walls, flips and max pain are never filtered by weight.")
hide_outside_rth = input.bool(false, "Draw only during regular hours", group="Filter")

// How each book renders. The index book is measured on the chain the chart
// actually tracks, so it draws as a line: a definite price. The ETF book is
// rescaled onto the index, where a $1 QQQ strike grid lands as a ~41-point band,
// so it draws as a zone — the width is the honest precision of the conversion,
// not decoration. Any book can be set to either or both.
index_style = input.string("Line", "Index book (NDX / SPX)", options=["Line", "Zone", "Line + zone"], group="Books")
confirm_style = input.string("Zone", "Confirmation book (QQQ / SPY)", options=["Line", "Zone", "Line + zone"], group="Books")
prior_style = input.string("Line", "Prior-session walls", options=["Line", "Zone", "Line + zone"], group="Books")
confirm_recolor = input.bool(true, "Tint the confirmation book", group="Books", tooltip="Off keeps the call/put colouring so an ETF wall reads as a wall; on makes which book a level came from the first thing you see.")
c_confirm = input.color(#6a5f8f, "Confirmation tint", group="Books")
prior_recolor = input.bool(true, "Tint prior-session walls", group="Books")
c_prior = input.color(#5a5f66, "Prior-session tint", group="Books")

show_zones = input.bool(true, "Draw zones at all", group="Style", tooltip="Master switch. Which books draw zones is set in the Books group.")
zone_width_mult = input.float(1.0, "Zone width in strike increments", minval=0.1, maxval=6.0, step=0.1, group="Style", tooltip="A zone of 1.0 spans exactly one strike increment of the book the level came from, after mapping onto this chart.")
zone_half_width = input.float(0.0, "Zone half-width override (0 = from strikes)", minval=0.0, step=0.25, group="Style")
merge_tolerance = input.float(0.0, "Merge levels within (0 = from zone width)", minval=0.0, step=0.25, group="Style", tooltip="Levels closer together than this are drawn once with their labels combined, which is what stops a wall, a gamma cluster and an expiry wall on the same strike from printing three overlapping lines.")
anchor_snapshot = input.bool(true, "Start lines at the snapshot bar", group="Style", tooltip="Levels measured at the snapshot time did not apply before it. Anchoring there also makes a stale payload obvious: the shorter the line, the fresher the data.")
left_bars = input.int(300, "Bars drawn to the left (when unanchored)", minval=0, maxval=5000, group="Style")
right_bars = input.int(30, "Bars projected to the right", minval=0, maxval=500, group="Style")
extend_right = input.bool(false, "Extend lines indefinitely", group="Style")
stagger_labels = input.bool(true, "Stagger crowded labels", group="Style")
show_prices = input.bool(true, "Price in label", group="Style")
c_call = input.color(#2f6b5f, "Call side", group="Style")
c_put = input.color(#a0443b, "Put side", group="Style")
c_flip = input.color(#8a641f, "Gamma flip", group="Style")
c_pain = input.color(#6f6378, "Max pain", group="Style")
c_vanna = input.color(#315f78, "Vanna magnet", group="Style")
c_delta = input.color(#4b6ea9, "Delta concentration", group="Style")
c_move = input.color(#7a7f8a, "Expected move", group="Style")

show_monitor = input.bool(true, "Mapping monitor", group="Tables")
show_level_table = input.bool(true, "Level table", group="Tables")
level_table_rows = input.int(10, "Level table rows", minval=1, maxval=20, group="Tables")
alerts_on = input.bool(true, "Name the level in alert() messages", group="Alerts", tooltip="Attach the script with \"Any alert() function call\" and the alert text names whichever level price reached.")

// Level kinds. Parallel arrays stand in for a record type, which Pine has no
// direct equivalent of.
//   0 call wall    1 put wall     2 gamma flip   3 max pain   4 vanna
//   5 gamma +      6 gamma -      7 delta +      8 delta -
//   9 expiry call 10 expiry put  11 expiry flip
//  12 volume call 13 volume put
//  14 prior call  15 prior put   16 prior flip
var float[] lv_price = array.new_float()
var string[] lv_label = array.new_string()
var int[] lv_kind = array.new_int()
var float[] lv_weight = array.new_float()
var int[] lv_role = array.new_int()
var float[] lv_step = array.new_float()

// The strike-by-strike exposure profile of the primary book.
var float[] hist_strike = array.new_float()
var float[] hist_value = array.new_float()

var bool parsed = false
var bool payload_ok = false
var bool payload_is_futures = false
var float payload_ref = 0.0
var float payload_epoch = 0.0

// Pine functions may mutate a global array by reference but may not assign to a
// global scalar, so the values the block parser has to hand back live here.
//   0 call wall  1 put wall  2 gamma flip  3 one-sigma bps  4 front DTE
//   5 primary spot  6 primary strike increment
var float[] meta_levels = array.new_float(7, na)
var string[] meta_names = array.new_string(2, "")

f_str(items, index) =>
    array.size(items) > index ? array.get(items, index) : ""

// Prices are never legitimately zero, so an empty or zero field means absent.
f_price(items, index) =>
    value = str.tonumber(str.trim(f_str(items, index)))
    na(value) or value == 0 ? float(na) : value

f_number(items, index) =>
    value = str.tonumber(str.trim(f_str(items, index)))
    na(value) ? 0.0 : value

f_push(price, text_value, kind, weight, role, step) =>
    if not na(price)
        array.push(lv_price, price)
        array.push(lv_label, text_value)
        array.push(lv_kind, kind)
        array.push(lv_weight, weight)
        array.push(lv_role, role)
        array.push(lv_step, step)

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
                        f_push(price, prefix + name_positive + " " + str.tostring(positive_rank), kind_positive, weight, role, step)
                    else
                        negative_rank := negative_rank + 1
                        f_push(price, prefix + name_negative + " " + str.tostring(negative_rank), kind_negative, weight, role, step)

f_parse_block(block) =>
    fields = str.split(block, "~")
    if array.size(fields) >= 8
        name = f_str(fields, 0)
        role = f_str(fields, 1) == "C" ? 1 : 0
        step = f_number(fields, 3)
        prefix = role == 1 ? name + " " : ""
        array.set(meta_names, role, name)

        aggregate = str.split(f_str(fields, 4), ",")
        call_wall = f_price(aggregate, 0)
        put_wall = f_price(aggregate, 1)
        flip = f_price(aggregate, 2)
        if role == 0
            array.set(meta_levels, 0, call_wall)
            array.set(meta_levels, 1, put_wall)
            array.set(meta_levels, 2, flip)
            array.set(meta_levels, 5, f_price(fields, 2))
            array.set(meta_levels, 6, step)
        f_push(call_wall, prefix + "Call Wall", 0, 1.0, role, step)
        f_push(put_wall, prefix + "Put Wall", 1, 1.0, role, step)
        f_push(flip, prefix + "Gamma Flip", 2, 1.0, role, step)
        f_push(f_price(aggregate, 3), prefix + "Max Pain", 3, 1.0, role, step)
        f_push(f_price(aggregate, 4), prefix + "Vanna Magnet", 4, 1.0, role, step)

        f_add_concentrations(f_str(fields, 5), 5, 6, "Gamma +", "Gamma -", prefix, role, step)
        f_add_concentrations(f_str(fields, 6), 7, 8, "Delta +", "Delta -", prefix, role, step)

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
                    f_push(f_price(slice, 1), label_text + " Call Wall", 9, weight, role, step)
                    f_push(f_price(slice, 2), label_text + " Put Wall", 10, weight, role, step)
                    f_push(f_price(slice, 3), label_text + " Flip", 11, weight, role, step)

        // The histogram belongs to the primary book alone. Two chains' profiles
        // on one axis would read as a single distribution and are not one.
        if role == 0 and array.size(fields) >= 9
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

        if array.size(fields) >= 10
            volume = str.split(f_str(fields, 9), ",")
            f_push(f_price(volume, 0), prefix + "Volume Call Wall", 12, 1.0, role, step)
            f_push(f_price(volume, 1), prefix + "Volume Put Wall", 13, 1.0, role, step)

        if role == 0 and array.size(fields) >= 11
            move = str.split(f_str(fields, 10), ",")
            array.set(meta_levels, 3, f_number(move, 0))
            array.set(meta_levels, 4, f_number(move, 1))

        if array.size(fields) >= 12
            prior = str.split(f_str(fields, 11), ",")
            f_push(f_price(prior, 0), "Prior Call Wall", 14, 1.0, role, step)
            f_push(f_price(prior, 1), "Prior Put Wall", 15, 1.0, role, step)
            f_push(f_price(prior, 2), "Prior Gamma Flip", 16, 1.0, role, step)

// Parsed once. Any change to the payload input recompiles the whole script, so
// there is nothing to invalidate.
if not parsed
    parsed := true
    if str.startswith(bridge, "GX2#")
        blocks = str.split(str.substring(bridge, 4), "|")
        header = str.split(f_str(blocks, 0), "~")
        payload_is_futures := f_str(header, 1) == "F"
        payload_ref := f_number(header, 3)
        payload_epoch := f_number(header, 4)
        payload_ok := true
        if array.size(blocks) > 1
            for block_index = 1 to array.size(blocks) - 1
                f_parse_block(array.get(blocks, block_index))

// The payload names the instrument it was built for, which selects the cash
// index without asking the user. str.contains over the input keeps the result
// simple-qualified so request.security still accepts the symbol.
is_nasdaq = str.contains(bridge, "~NQ~")
cash_symbol = is_nasdaq ? ndx_symbol : spx_symbol

// Both series are requested on the daily timeframe, and that is load-bearing
// rather than a matter of taste.
//
// Asking for the cash index at the chart's own resolution pairs a 24-hour
// futures session with an index that only prints during regular hours. Pine
// aligns the two by time, so every overnight and holiday gap widens the offset
// it must reach back through, and that offset grows for as long as the chart
// does: it overran a 493-bar buffer around bar 10,000 and a 1,277-bar buffer
// around bar 10,900. No fixed buffer survives it. On the daily timeframe the
// two symbols share a bar for every session they both trade, so the offset
// cannot accumulate.
//
// The cost is that the relationship is one session old intraday. That suits
// what it measures: a futures basis decays over weeks toward expiry and an
// index-to-ETF ratio is near constant, so both are wrong by far less over a
// session than an intraday chart price compared against a fixed index close
// would be.
cash_daily = request.security(cash_symbol, "D", close, lookahead=barmerge.lookahead_off)
chart_daily = request.security(syminfo.tickerid, "D", close, lookahead=barmerge.lookahead_off)

// The last N sessions on which both printed. A daily value only changes once a
// session, so a sample is taken when the reading actually moves rather than on
// every bar, which would otherwise fill the window with one repeated number.
var float[] ratio_window = array.new_float()
var float[] basis_window = array.new_float()
var float held_ratio = na
var float held_basis = na
var float held_cash = na
var float held_chart = na
if not na(cash_daily) and cash_daily > 0 and not na(chart_daily) and (na(held_cash) or cash_daily != held_cash or chart_daily != held_chart)
    array.push(ratio_window, chart_daily / cash_daily)
    array.push(basis_window, chart_daily - cash_daily)
    if array.size(ratio_window) > map_samples
        array.shift(ratio_window)
        array.shift(basis_window)
    held_ratio := array.avg(ratio_window)
    held_basis := array.avg(basis_window)
    held_cash := cash_daily
    held_chart := chart_daily

// The last bar at or before the snapshot. Levels measured then did not apply to
// the price action before it, so that is where their lines begin.
var int snapshot_bar = 0
if payload_epoch > 0 and time <= payload_epoch * 1000
    snapshot_bar := bar_index
// A payload from before this trading day opened is describing yesterday's book.
payload_before_session = payload_epoch > 0 and payload_epoch * 1000 < time_tradingday

// How far this chart trades from the payload's own reference price. Near 1 the
// chart is already in the payload's price space and nothing needs mapping;
// around 0.024 it is the ETF, around 1.005 the front future.
reference_gap = payload_ref > 0 ? math.abs(close / payload_ref - 1) : float(na)
auto_mode = payload_is_futures ? (na(reference_gap) or reference_gap < 0.10 ? "None" : "Payload-reference ratio") : (na(held_ratio) ? (payload_ref > 0 ? "Payload-reference ratio" : "None") : "Cash-index ratio")
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
    kind == 0 or kind == 1 ? 0 : kind == 2 ? 1 : kind == 5 or kind == 6 ? 2 : kind == 12 or kind == 13 ? 2 : kind == 9 or kind == 10 ? 3 : kind == 11 ? 4 : kind == 3 ? 5 : kind == 4 ? 6 : kind >= 14 ? 8 : 7

f_color(kind) =>
    kind == 0 or kind == 5 or kind == 9 or kind == 12 or kind == 14 ? c_call : kind == 1 or kind == 6 or kind == 10 or kind == 13 or kind == 15 ? c_put : kind == 2 or kind == 11 or kind == 16 ? c_flip : kind == 3 ? c_pain : kind == 4 ? c_vanna : c_delta

f_visible(kind) =>
    kind == 0 or kind == 1 ? show_aggregate_walls : kind == 2 or kind == 11 ? show_flips : kind == 3 ? show_max_pain : kind == 4 ? show_vanna : kind == 5 or kind == 6 ? show_gamma : kind == 7 or kind == 8 ? show_delta : kind == 12 or kind == 13 ? show_volume_walls : kind >= 14 ? show_prior : show_expiry_walls

f_weight_filtered(kind, weight) =>
    (kind >= 5 and kind <= 8) and weight * 100 < min_weight

// Which book a level belongs to: 0 the index chain, 1 the confirmation chain,
// 2 the previous session. Style, colour and emphasis all follow from this.
f_class(kind, role) =>
    kind >= 14 ? 2 : role == 1 ? 1 : 0

f_class_style(book) =>
    book == 0 ? index_style : book == 1 ? confirm_style : prior_style

f_has_line(book) =>
    style = f_class_style(book)
    style == "Line" or style == "Line + zone"

f_has_zone(book) =>
    style = f_class_style(book)
    style == "Zone" or style == "Line + zone"

// The index book keeps the call/put colouring, because there a wall should read
// as a wall. A level only the ETF or only the previous session produced takes
// that book's tint, so where it came from is the first thing you see.
f_tone(kind, from_index, from_confirm) =>
    from_index ? f_color(kind) : from_confirm ? (confirm_recolor ? c_confirm : f_color(kind)) : (prior_recolor ? c_prior : f_color(kind))

f_half_width(step) =>
    base = zone_half_width > 0 ? zone_half_width : nz(f_map_width(step), 0) * zone_width_mult / 2
    math.max(base, syminfo.mintick)

// Roughly how far apart two labels have to be before they stop overlapping.
// Derived from the recent range because Pine cannot see the pixel scale.
label_gap = (ta.highest(high, 200) - ta.lowest(low, 200)) / 28

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
var bool[] merged_prior = array.new_bool()
var int[] merged_slot = array.new_int()

f_emit(price, text_value, kind, half, weight, from_index, from_confirm, from_prior) =>
    array.push(merged_price, price)
    array.push(merged_label, text_value)
    array.push(merged_kind, kind)
    array.push(merged_half, half)
    array.push(merged_weight, weight)
    array.push(merged_index, from_index)
    array.push(merged_confirm, from_confirm)
    array.push(merged_prior, from_prior)

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
    from_prior = array.get(merged_prior, index)
    agreed = from_index and from_confirm
    // A merged level draws whatever any of its contributing books asks for, so
    // an index line and an ETF zone on the same price render as a line inside
    // its confirmation band rather than one of the two silently winning.
    wants_line = (from_index and f_has_line(0)) or (from_confirm and f_has_line(1)) or (from_prior and f_has_line(2))
    draw_zone = show_zones and half > 0 and ((from_index and f_has_zone(0)) or (from_confirm and f_has_zone(1)) or (from_prior and f_has_zone(2)))
    // A zone-only book must not disappear when zones are switched off globally;
    // it falls back to a line so the level is still on the chart.
    draw_line = wants_line or not draw_zone
    if draw_line or draw_zone
        tone = f_tone(kind, from_index, from_confirm)
        dim = not from_index
        structural = f_priority(kind) <= 1
        thickness = (structural or weight >= 0.66 ? 2 : 1) + (agreed ? 1 : 0)
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
        distance = close > 0 ? (price / close - 1) * 100 : 0.0
        caption = (agreed ? "✓ " : "") + array.get(merged_label, index) +
          (show_prices ? "  " + str.tostring(price, format.mintick) : "") +
          "  (" + (distance >= 0 ? "+" : "") + str.tostring(distance, "#.##") + "%)"
        array.push(drawn_labels, label.new(
          x=f_future(right_bars + 2 + (show_profile ? profile_bars + 3 : 0) + array.get(merged_slot, index) * 9),
          y=price,
          text=caption,
          style=label.style_label_left,
          color=color.new(tone, 100),
          textcolor=dim ? color.new(tone, 25) : tone,
          size=size.small))

var table monitor = table.new(position.bottom_right, 2, 8, border_width=0)
var table levels_table = table.new(position.top_right, 3, 21, border_width=0)

f_monitor_row(row, name, value, tone) =>
    table.cell(monitor, 0, row, name, text_color=color.gray, text_size=size.tiny, text_halign=text.align_left)
    table.cell(monitor, 1, row, value, text_color=tone, text_size=size.tiny, text_halign=text.align_right)

// Gamma regime. Above the flip dealer hedging leans against price, below it
// leans with price, and that single fact reframes every other level on the
// chart. Only shaded forward of the snapshot, where the flip actually applied.
regime_price = f_map(array.get(meta_levels, 2))
regime_active = show_regime and not na(regime_price) and (snapshot_bar == 0 or bar_index >= snapshot_bar)
bgcolor(regime_active ? (close > regime_price ? color.new(c_call, regime_transparency) : color.new(c_put, regime_transparency)) : na)

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
    array.clear(merged_prior)
    array.clear(merged_slot)

    drawing = not hide_outside_rth or session.ismarket

    visible_price = array.new_float()
    visible_source = array.new_int()
    if array.size(lv_price) > 0 and drawing
        for source_index = 0 to array.size(lv_price) - 1
            kind = array.get(lv_kind, source_index)
            role = array.get(lv_role, source_index)
            weight = array.get(lv_weight, source_index)
            if f_visible(kind) and (role == 0 or show_confirmation) and not f_weight_filtered(kind, weight)
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
        bool group_open = false
        float group_price = 0.0
        float group_anchor = 0.0
        string group_text = ""
        int group_kind = 0
        int group_priority = 99
        float group_half = 0.0
        float group_weight = 0.0
        bool group_index = false
        bool group_confirm = false
        bool group_prior = false
        for rank = 0 to array.size(by_price) - 1
            slot = array.get(by_price, rank)
            price = array.get(visible_price, slot)
            source_index = array.get(visible_source, slot)
            kind = array.get(lv_kind, source_index)
            priority = f_priority(kind)
            half = f_half_width(array.get(lv_step, source_index))
            weight = array.get(lv_weight, source_index)
            role = array.get(lv_role, source_index)
            book = f_class(kind, role)
            tolerance = merge_tolerance > 0 ? merge_tolerance : group_half * 1.2
            if group_open and price - group_anchor > tolerance
                f_emit(group_price, group_text, group_kind, group_half, group_weight, group_index, group_confirm, group_prior)
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
                group_index := book == 0
                group_confirm := book == 1
                group_prior := book == 2
            else
                group_text := group_text + "  ·  " + array.get(lv_label, source_index)
                group_half := math.max(group_half, half)
                group_weight := math.max(group_weight, weight)
                group_index := group_index or book == 0
                group_confirm := group_confirm or book == 1
                group_prior := group_prior or book == 2
                if priority < group_priority
                    group_priority := priority
                    group_kind := kind
                    group_price := price
        if group_open
            f_emit(group_price, group_text, group_kind, group_half, group_weight, group_index, group_confirm, group_prior)

    total = array.size(merged_price)
    // Merged levels arrive in ascending price order, so a run of prices closer
    // together than a label is tall gets its labels stepped sideways instead of
    // stacked on top of each other.
    float previous_price = na
    int stagger = 0
    if total > 0
        for index = 0 to total - 1
            price = array.get(merged_price, index)
            if not na(previous_price) and stagger_labels and label_gap > 0 and price - previous_price < label_gap
                stagger := stagger >= 3 ? 0 : stagger + 1
            else
                stagger := 0
            array.push(merged_slot, stagger)
            previous_price := price

    distances = array.new_float()
    if total > 0
        for index = 0 to total - 1
            array.push(distances, math.abs(array.get(merged_price, index) - close))
    nearest = total > 0 ? array.sort_indices(distances, order.ascending) : array.new_int()
    drawn = max_levels > 0 ? math.min(max_levels, total) : total
    if drawn > 0
        for rank = 0 to drawn - 1
            f_render(array.get(nearest, rank))

    // The exposure histogram: the distribution the walls are the peaks of. A
    // level with a broad shoulder behind it is a different proposition from an
    // isolated spike, and the lines alone cannot say which is which.
    if show_profile and drawing and array.size(hist_strike) > 0
        profile_left = f_future(right_bars + 2)
        bar_half = math.max(nz(f_map_width(array.get(meta_levels, 6)), 0) * 0.45, syminfo.mintick)
        for point_index = 0 to array.size(hist_strike) - 1
            level = f_map(array.get(hist_strike, point_index))
            exposure = array.get(hist_value, point_index)
            if not na(level)
                tone = exposure > 0 ? c_call : c_put
                length = math.max(1, math.round(math.abs(exposure) / 100 * profile_bars))
                array.push(drawn_boxes, box.new(
                  left=profile_left,
                  top=level + bar_half,
                  right=math.min(profile_left + length, bar_index + 500),
                  bottom=level - bar_half,
                  border_color=color.new(tone, 75),
                  bgcolor=color.new(tone, 55)))

    // Expected move. The walls say where hedging sits; this says whether today
    // has the volatility to reach them.
    sigma_bps = array.get(meta_levels, 3)
    move_anchor = f_map(array.get(meta_levels, 5))
    if show_expected_move and drawing and not na(move_anchor) and not na(sigma_bps) and sigma_bps > 0
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

    table.clear(monitor, 0, 0, 1, 7)
    if show_monitor
        age_hours = payload_epoch > 0 ? (timenow / 1000 - payload_epoch) / 3600 : float(na)
        drift = payload_ref > 0 and not na(map_factor) and not na(map_offset) ? math.abs((payload_ref * map_factor + map_offset) / close - 1) * 100 : float(na)
        primary_name = array.get(meta_names, 0)
        confirm_name = array.get(meta_names, 1)
        f_monitor_row(0, "PAYLOAD", payload_ok ? (primary_name == "" ? "LOADED" : primary_name) + (confirm_name == "" ? "" : " + " + confirm_name) : "PASTE GX2 BRIDGE", payload_ok ? color.white : color.orange)
        f_monitor_row(1, "SESSION", not payload_ok ? "—" : payload_before_session ? "PRIOR SESSION" : "CURRENT", payload_before_session ? color.orange : color.white)
        f_monitor_row(2, "AGE", na(age_hours) ? "—" : str.tostring(age_hours, "#.#") + "h", na(age_hours) or age_hours > 24 ? color.orange : color.white)
        f_monitor_row(3, "REGIME", na(regime_price) ? "—" : close > regime_price ? "POSITIVE GAMMA" : "NEGATIVE GAMMA", na(regime_price) ? color.gray : close > regime_price ? color.white : color.orange)
        f_monitor_row(4, "MAPPING", active_mode + (map_mode == "Auto" ? " (auto)" : ""), na(map_factor) or na(map_offset) ? color.orange : color.white)
        f_monitor_row(5, "FACTOR", str.tostring(map_factor, "#.######") + (map_offset != 0 ? "  " + str.tostring(map_offset, "#.##") : ""), color.white)
        f_monitor_row(6, "CASH / CHART", str.tostring(held_cash, "#.##") + " / " + str.tostring(held_chart, "#.##") + " (daily)", color.white)
        // A large drift means the payload's own reference price no longer maps
        // onto this chart, which is the signal that the levels are stale or that
        // the wrong mapping mode is selected.
        f_monitor_row(7, "DRIFT", na(drift) ? "—" : str.tostring(drift, "#.##") + "%", na(drift) or drift > 1.5 ? color.orange : color.white)

    table.clear(levels_table, 0, 0, 2, 20)
    if show_level_table and total > 0
        table.cell(levels_table, 0, 0, "LEVEL", text_color=color.gray, text_size=size.tiny, text_halign=text.align_left)
        table.cell(levels_table, 1, 0, "PRICE", text_color=color.gray, text_size=size.tiny, text_halign=text.align_right)
        table.cell(levels_table, 2, 0, "DIST", text_color=color.gray, text_size=size.tiny, text_halign=text.align_right)
        listed = math.min(level_table_rows, total)
        for rank = 0 to listed - 1
            index = array.get(nearest, rank)
            price = array.get(merged_price, index)
            tone = f_tone(array.get(merged_kind, index), array.get(merged_index, index), array.get(merged_confirm, index))
            distance = close > 0 ? (price / close - 1) * 100 : 0.0
            table.cell(levels_table, 0, rank + 1, (array.get(merged_index, index) and array.get(merged_confirm, index) ? "✓ " : "") + array.get(merged_label, index), text_color=tone, text_size=size.tiny, text_halign=text.align_left)
            table.cell(levels_table, 1, rank + 1, str.tostring(price, format.mintick), text_color=color.white, text_size=size.tiny, text_halign=text.align_right)
            table.cell(levels_table, 2, rank + 1, (distance >= 0 ? "+" : "") + str.tostring(distance, "#.##") + "%", text_color=color.gray, text_size=size.tiny, text_halign=text.align_right)

    // One alert covering every drawn level, naming whichever price reached.
    // Attach the script with "Any alert() function call".
    // One alert per bar carrying every level the bar reached. alert() throttles
    // by call site rather than by message, so firing inside the loop would
    // report whichever level happened to be nearest and silently drop the rest.
    if alerts_on and drawn > 0
        string touched = ""
        for rank = 0 to drawn - 1
            index = array.get(nearest, rank)
            price = array.get(merged_price, index)
            if high >= price and low <= price
                touched := touched + (touched == "" ? "" : ", ") + array.get(merged_label, index) +
                  " " + str.tostring(price, format.mintick)
        if touched != ""
            alert("GEXLab " + syminfo.ticker + ": " + touched, alert.freq_once_per_bar)

// Static alerts for the primary book's structural levels, for anyone who wants
// them wired individually rather than through one alert() stream.
call_price = f_map(array.get(meta_levels, 0))
put_price = f_map(array.get(meta_levels, 1))
flip_price = f_map(array.get(meta_levels, 2))
flip_guard = nz(flip_price, close)
alertcondition(not na(call_price) and high >= call_price and low <= call_price, "Call wall touched", "GEXLab: price reached the call wall")
alertcondition(not na(put_price) and high >= put_price and low <= put_price, "Put wall touched", "GEXLab: price reached the put wall")
alertcondition(not na(flip_price) and ta.crossover(close, flip_guard), "Crossed above gamma flip", "GEXLab: closed above the gamma flip")
alertcondition(not na(flip_price) and ta.crossunder(close, flip_guard), "Crossed below gamma flip", "GEXLab: closed below the gamma flip")
`;
