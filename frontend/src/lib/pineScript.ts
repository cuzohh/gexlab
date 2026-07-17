export const PINE_SCRIPT = String.raw`//@version=6
indicator("GexLab Futures Levels", overlay=true, max_lines_count=50, max_labels_count=50)

// Paste the "pine" value from http://localhost:8000/api/metrics/bridge.
// Format per section:
// d0cw,d0pw,d0vt,d1cw,d1pw,d1vt,vf,vcw,vpw,cf,ccw,cpw,l1u,l1d,l2u,l2d,sf,scw,spw,zf,zcw,zpw
pine_data = input.text_area("", title="Futures Levels", group="Data")

show_0dte = input.bool(true, "0DTE", group="Levels")
show_1dte = input.bool(true, "1DTE", group="Levels")
show_vanna = input.bool(true, "Vanna", group="Levels")
show_charm = input.bool(true, "Charm", group="Levels")
show_lambda = input.bool(true, "λ Targets", group="Levels")
show_speed = input.bool(true, "Speed", group="Levels")
show_zomma = input.bool(true, "Zomma", group="Levels")
show_boxes = input.bool(true, "Boxes", group="Style")
box_half_override = input.float(0.0, "Box Half-Width, Points (0 = Auto)", minval=0.0, step=0.25, group="Style")

symbol_text = str.upper(syminfo.ticker)
is_nq = str.contains(symbol_text, "NQ")
section_idx = is_nq ? 1 : 0
auto_half_points = is_nq ? 20.0 : 5.0
box_half_points = box_half_override > 0 ? box_half_override : auto_half_points

f_parse(idx) =>
    sections = str.split(pine_data, "|")
    section = array.size(sections) > section_idx ? array.get(sections, section_idx) : ""
    fields = str.split(section, ",")
    raw = array.size(fields) > idx ? str.tonumber(str.trim(array.get(fields, idx))) : float(na)
    raw == 0.0 ? float(na) : raw

tick(v) => na(v) ? float(na) : math.round(v * 4.0) / 4.0

d0cw = show_0dte ? tick(f_parse(0)) : float(na)
d0pw = show_0dte ? tick(f_parse(1)) : float(na)
d0vt = show_0dte ? tick(f_parse(2)) : float(na)
d1cw = show_1dte ? tick(f_parse(3)) : float(na)
d1pw = show_1dte ? tick(f_parse(4)) : float(na)
d1vt = show_1dte ? tick(f_parse(5)) : float(na)
vf = show_vanna ? tick(f_parse(6)) : float(na)
vcw = show_vanna ? tick(f_parse(7)) : float(na)
vpw = show_vanna ? tick(f_parse(8)) : float(na)
cf = show_charm ? tick(f_parse(9)) : float(na)
ccw = show_charm ? tick(f_parse(10)) : float(na)
cpw = show_charm ? tick(f_parse(11)) : float(na)
l1u = show_lambda ? tick(f_parse(12)) : float(na)
l1d = show_lambda ? tick(f_parse(13)) : float(na)
l2u = show_lambda ? tick(f_parse(14)) : float(na)
l2d = show_lambda ? tick(f_parse(15)) : float(na)
sf = show_speed ? tick(f_parse(16)) : float(na)
scw = show_speed ? tick(f_parse(17)) : float(na)
spw = show_speed ? tick(f_parse(18)) : float(na)
zf = show_zomma ? tick(f_parse(19)) : float(na)
zcw = show_zomma ? tick(f_parse(20)) : float(na)
zpw = show_zomma ? tick(f_parse(21)) : float(na)

box_hi(v) => show_boxes and not na(v) ? tick(v + box_half_points) : float(na)
box_lo(v) => show_boxes and not na(v) ? tick(v - box_half_points) : float(na)

NO_AXIS = display.pane

p_d0cw_hi = plot(box_hi(d0cw), "0DTE Call Wall Box Hi", color=color.new(#15803d, 0), linewidth=1, editable=false, display=NO_AXIS)
p_d0cw_lo = plot(box_lo(d0cw), "0DTE Call Wall Box Lo", color=color.new(#15803d, 0), linewidth=1, editable=false, display=NO_AXIS)
p_d0pw_hi = plot(box_hi(d0pw), "0DTE Put Wall Box Hi", color=color.new(#b91c1c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_d0pw_lo = plot(box_lo(d0pw), "0DTE Put Wall Box Lo", color=color.new(#b91c1c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_d0vt_hi = plot(box_hi(d0vt), "0DTE Vol Trigger Box Hi", color=color.new(#b45309, 0), linewidth=1, editable=false, display=NO_AXIS)
p_d0vt_lo = plot(box_lo(d0vt), "0DTE Vol Trigger Box Lo", color=color.new(#b45309, 0), linewidth=1, editable=false, display=NO_AXIS)

p_d1cw_hi = plot(box_hi(d1cw), "1DTE Call Wall Box Hi", color=color.new(#15803d, 35), linewidth=1, editable=false, display=NO_AXIS)
p_d1cw_lo = plot(box_lo(d1cw), "1DTE Call Wall Box Lo", color=color.new(#15803d, 35), linewidth=1, editable=false, display=NO_AXIS)
p_d1pw_hi = plot(box_hi(d1pw), "1DTE Put Wall Box Hi", color=color.new(#b91c1c, 35), linewidth=1, editable=false, display=NO_AXIS)
p_d1pw_lo = plot(box_lo(d1pw), "1DTE Put Wall Box Lo", color=color.new(#b91c1c, 35), linewidth=1, editable=false, display=NO_AXIS)
p_d1vt_hi = plot(box_hi(d1vt), "1DTE Vol Trigger Box Hi", color=color.new(#b45309, 40), linewidth=1, editable=false, display=NO_AXIS)
p_d1vt_lo = plot(box_lo(d1vt), "1DTE Vol Trigger Box Lo", color=color.new(#b45309, 40), linewidth=1, editable=false, display=NO_AXIS)
p_vcw_hi = plot(box_hi(vcw), "Vanna Call Wall Box Hi", color=color.new(#6d28d9, 0), linewidth=1, editable=false, display=NO_AXIS)
p_vcw_lo = plot(box_lo(vcw), "Vanna Call Wall Box Lo", color=color.new(#6d28d9, 0), linewidth=1, editable=false, display=NO_AXIS)
p_vpw_hi = plot(box_hi(vpw), "Vanna Put Wall Box Hi", color=color.new(#6d28d9, 0), linewidth=1, editable=false, display=NO_AXIS)
p_vpw_lo = plot(box_lo(vpw), "Vanna Put Wall Box Lo", color=color.new(#6d28d9, 0), linewidth=1, editable=false, display=NO_AXIS)
p_ccw_hi = plot(box_hi(ccw), "Charm Call Wall Box Hi", color=color.new(#0e7490, 0), linewidth=1, editable=false, display=NO_AXIS)
p_ccw_lo = plot(box_lo(ccw), "Charm Call Wall Box Lo", color=color.new(#0e7490, 0), linewidth=1, editable=false, display=NO_AXIS)
p_cpw_hi = plot(box_hi(cpw), "Charm Put Wall Box Hi", color=color.new(#0e7490, 0), linewidth=1, editable=false, display=NO_AXIS)
p_cpw_lo = plot(box_lo(cpw), "Charm Put Wall Box Lo", color=color.new(#0e7490, 0), linewidth=1, editable=false, display=NO_AXIS)
p_scw_hi = plot(box_hi(scw), "Speed Call Wall Box Hi", color=color.new(#be123c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_scw_lo = plot(box_lo(scw), "Speed Call Wall Box Lo", color=color.new(#be123c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_spw_hi = plot(box_hi(spw), "Speed Put Wall Box Hi", color=color.new(#be123c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_spw_lo = plot(box_lo(spw), "Speed Put Wall Box Lo", color=color.new(#be123c, 0), linewidth=1, editable=false, display=NO_AXIS)
p_zcw_hi = plot(box_hi(zcw), "Zomma Call Wall Box Hi", color=color.new(#4f46e5, 0), linewidth=1, editable=false, display=NO_AXIS)
p_zcw_lo = plot(box_lo(zcw), "Zomma Call Wall Box Lo", color=color.new(#4f46e5, 0), linewidth=1, editable=false, display=NO_AXIS)
p_zpw_hi = plot(box_hi(zpw), "Zomma Put Wall Box Hi", color=color.new(#4f46e5, 0), linewidth=1, editable=false, display=NO_AXIS)
p_zpw_lo = plot(box_lo(zpw), "Zomma Put Wall Box Lo", color=color.new(#4f46e5, 0), linewidth=1, editable=false, display=NO_AXIS)

fill(p_d0cw_hi, p_d0cw_lo, color=color.new(#22c55e, 86), title="0DTE Call Wall Box")
fill(p_d0pw_hi, p_d0pw_lo, color=color.new(#ef4444, 86), title="0DTE Put Wall Box")
fill(p_d0vt_hi, p_d0vt_lo, color=color.new(#f59e0b, 88), title="0DTE Vol Trigger Box")
fill(p_d1cw_hi, p_d1cw_lo, color=color.new(#22c55e, 92), title="1DTE Call Wall Box")
fill(p_d1pw_hi, p_d1pw_lo, color=color.new(#ef4444, 92), title="1DTE Put Wall Box")
fill(p_d1vt_hi, p_d1vt_lo, color=color.new(#f59e0b, 93), title="1DTE Vol Trigger Box")
fill(p_vcw_hi, p_vcw_lo, color=color.new(#8b5cf6, 94), title="Vanna Call Wall Box")
fill(p_vpw_hi, p_vpw_lo, color=color.new(#8b5cf6, 94), title="Vanna Put Wall Box")
fill(p_ccw_hi, p_ccw_lo, color=color.new(#06b6d4, 94), title="Charm Call Wall Box")
fill(p_cpw_hi, p_cpw_lo, color=color.new(#06b6d4, 94), title="Charm Put Wall Box")
fill(p_scw_hi, p_scw_lo, color=color.new(#f43f5e, 94), title="Speed Call Wall Box")
fill(p_spw_hi, p_spw_lo, color=color.new(#f43f5e, 94), title="Speed Put Wall Box")
fill(p_zcw_hi, p_zcw_lo, color=color.new(#6366f1, 94), title="Zomma Call Wall Box")
fill(p_zpw_hi, p_zpw_lo, color=color.new(#6366f1, 94), title="Zomma Put Wall Box")

f_midline(prev, price, col) =>
    if not na(prev)
        line.delete(prev)
    not na(price) and barstate.islast ? line.new(bar_index - 1000, price, bar_index + 25, price, xloc=xloc.bar_index, extend=extend.none, color=col, width=1, style=line.style_dotted) : na

var line line_d0cw = na
var line line_d0pw = na
var line line_d0vt = na
var line line_d1cw = na
var line line_d1pw = na
var line line_d1vt = na
var line line_vf = na
var line line_vcw = na
var line line_vpw = na
var line line_cf = na
var line line_ccw = na
var line line_cpw = na
var line line_l1u = na
var line line_l1d = na
var line line_l2u = na
var line line_l2d = na
var line line_sf = na
var line line_scw = na
var line line_spw = na
var line line_zf = na
var line line_zcw = na
var line line_zpw = na

if barstate.islast
    line_d0cw := f_midline(line_d0cw, d0cw, color.new(#16a34a, 0))
    line_d0pw := f_midline(line_d0pw, d0pw, color.new(#dc2626, 0))
    line_d0vt := f_midline(line_d0vt, d0vt, color.new(#d97706, 0))
    line_d1cw := f_midline(line_d1cw, d1cw, color.new(#16a34a, 45))
    line_d1pw := f_midline(line_d1pw, d1pw, color.new(#dc2626, 45))
    line_d1vt := f_midline(line_d1vt, d1vt, color.new(#d97706, 45))
    line_vf := f_midline(line_vf, vf, color.new(#8b5cf6, 5))
    line_vcw := f_midline(line_vcw, vcw, color.new(#8b5cf6, 35))
    line_vpw := f_midline(line_vpw, vpw, color.new(#8b5cf6, 35))
    line_cf := f_midline(line_cf, cf, color.new(#0891b2, 5))
    line_ccw := f_midline(line_ccw, ccw, color.new(#0891b2, 35))
    line_cpw := f_midline(line_cpw, cpw, color.new(#0891b2, 35))
    line_l1u := f_midline(line_l1u, l1u, color.new(#2563eb, 15))
    line_l1d := f_midline(line_l1d, l1d, color.new(#2563eb, 15))
    line_l2u := f_midline(line_l2u, l2u, color.new(#7c3aed, 10))
    line_l2d := f_midline(line_l2d, l2d, color.new(#7c3aed, 10))
    line_sf := f_midline(line_sf, sf, color.new(#be123c, 5))
    line_scw := f_midline(line_scw, scw, color.new(#be123c, 35))
    line_spw := f_midline(line_spw, spw, color.new(#be123c, 35))
    line_zf := f_midline(line_zf, zf, color.new(#4f46e5, 5))
    line_zcw := f_midline(line_zcw, zcw, color.new(#4f46e5, 35))
    line_zpw := f_midline(line_zpw, zpw, color.new(#4f46e5, 35))

f_label(prev, price, txt, col, x_offset) =>
    if not na(prev)
        label.delete(prev)
    not na(price) and barstate.islast ? label.new(bar_index + x_offset, price, txt, xloc=xloc.bar_index, style=label.style_label_left, color=color.new(col, 100), textcolor=col, size=size.small, textalign=text.align_left) : na

var label lbl_d0cw = na
var label lbl_d0pw = na
var label lbl_d0vt = na
var label lbl_d1cw = na
var label lbl_d1pw = na
var label lbl_d1vt = na
var label lbl_vf = na
var label lbl_vcw = na
var label lbl_vpw = na
var label lbl_cf = na
var label lbl_ccw = na
var label lbl_cpw = na
var label lbl_l1u = na
var label lbl_l1d = na
var label lbl_l2u = na
var label lbl_l2d = na
var label lbl_sf = na
var label lbl_scw = na
var label lbl_spw = na
var label lbl_zf = na
var label lbl_zcw = na
var label lbl_zpw = na

if barstate.islast
    lbl_d0cw := f_label(lbl_d0cw, d0cw, "0DTE Γ CW", #15803d, 26)
    lbl_d0pw := f_label(lbl_d0pw, d0pw, "0DTE Γ PW", #b91c1c, 26)
    lbl_d0vt := f_label(lbl_d0vt, d0vt, "0DTE Γ VT", #b45309, 26)
    lbl_d1cw := f_label(lbl_d1cw, d1cw, "1DTE Γ CW", #15803d, 26)
    lbl_d1pw := f_label(lbl_d1pw, d1pw, "1DTE Γ PW", #b91c1c, 26)
    lbl_d1vt := f_label(lbl_d1vt, d1vt, "1DTE Γ VT", #b45309, 26)
    lbl_vf := f_label(lbl_vf, vf, "Vanna F", #8b5cf6, 35)
    lbl_vcw := f_label(lbl_vcw, vcw, "Vanna CW", #8b5cf6, 35)
    lbl_vpw := f_label(lbl_vpw, vpw, "Vanna PW", #8b5cf6, 35)
    lbl_cf := f_label(lbl_cf, cf, "Charm F", #0891b2, 44)
    lbl_ccw := f_label(lbl_ccw, ccw, "Charm CW", #0891b2, 44)
    lbl_cpw := f_label(lbl_cpw, cpw, "Charm PW", #0891b2, 44)
    lbl_l1u := f_label(lbl_l1u, l1u, "λ +1σ", #2563eb, 53)
    lbl_l1d := f_label(lbl_l1d, l1d, "λ -1σ", #2563eb, 53)
    lbl_l2u := f_label(lbl_l2u, l2u, "λ +2σ", #7c3aed, 62)
    lbl_l2d := f_label(lbl_l2d, l2d, "λ -2σ", #7c3aed, 62)
    lbl_sf := f_label(lbl_sf, sf, "Speed F", #be123c, 71)
    lbl_scw := f_label(lbl_scw, scw, "Speed CW", #be123c, 71)
    lbl_spw := f_label(lbl_spw, spw, "Speed PW", #be123c, 71)
    lbl_zf := f_label(lbl_zf, zf, "Zomma F", #4f46e5, 80)
    lbl_zcw := f_label(lbl_zcw, zcw, "Zomma CW", #4f46e5, 80)
    lbl_zpw := f_label(lbl_zpw, zpw, "Zomma PW", #4f46e5, 80)
`;
