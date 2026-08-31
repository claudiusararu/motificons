import SwiftUI

struct PhAcorn: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 256.0
        let vh = 256.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(232.0, 104.0))
        path.addCurve(to: p(176.0, 48.0), control1: p(231.9669, 73.0858), control2: p(206.9142, 48.0331))
        path.addLine(to: p(136.0, 48.0))
        path.addCurve(to: p(160.0, 24.0), control1: p(136.0, 34.7452), control2: p(146.7452, 24.0))
        path.addCurve(to: p(168.0, 16.0), control1: p(164.4183, 24.0), control2: p(168.0, 20.4183))
        path.addCurve(to: p(160.0, 8.0), control1: p(168.0, 11.5817), control2: p(164.4183, 8.0))
        path.addCurve(to: p(120.0, 48.0), control1: p(137.9086, 8.0), control2: p(120.0, 25.9086))
        path.addLine(to: p(80.0, 48.0))
        path.addCurve(to: p(24.0, 104.0), control1: p(49.0858, 48.0331), control2: p(24.0331, 73.0858))
        path.addCurve(to: p(32.0, 117.83), control1: p(24.0094, 109.7068), control2: p(27.0577, 114.9766))
        path.addLine(to: p(32.0, 128.0))
        path.addCurve(to: p(91.74, 211.49), control1: p(32.0, 163.53), control2: p(65.12, 190.12))
        path.addCurve(to: p(120.0, 240.0), control1: p(103.66, 221.07), control2: p(120.0, 234.18))
        path.addCurve(to: p(128.0, 248.0), control1: p(120.0, 244.4183), control2: p(123.5817, 248.0))
        path.addCurve(to: p(136.0, 240.0), control1: p(132.4183, 248.0), control2: p(136.0, 244.4183))
        path.addCurve(to: p(164.26, 211.49), control1: p(136.0, 234.18), control2: p(152.34, 221.07))
        path.addCurve(to: p(224.0, 128.0), control1: p(190.88, 190.12), control2: p(224.0, 163.53))
        path.addLine(to: p(224.0, 117.83))
        path.addCurve(to: p(232.0, 104.0), control1: p(228.9423, 114.9766), control2: p(231.9906, 109.7068))
        path.move(to: p(80.0, 64.0))
        path.addLine(to: p(176.0, 64.0))
        path.addCurve(to: p(216.0, 104.0), control1: p(198.0777, 64.033), control2: p(215.967, 81.9223))
        path.addLine(to: p(40.0, 104.0))
        path.addCurve(to: p(80.0, 64.0), control1: p(40.0, 81.9086), control2: p(57.9086, 64.0))
        path.move(to: p(154.25, 199.0))
        path.addCurve(to: p(128.0, 222.37), control1: p(143.63, 207.52), control2: p(134.25, 215.0))
        path.addCurve(to: p(101.75, 199.0), control1: p(121.75, 215.05), control2: p(112.37, 207.52))
        path.addCurve(to: p(48.0, 128.0), control1: p(77.8, 179.79), control2: p(48.0, 155.86))
        path.addLine(to: p(48.0, 120.0))
        path.addLine(to: p(208.0, 120.0))
        path.addLine(to: p(208.0, 128.0))
        path.addCurve(to: p(154.25, 199.0), control1: p(208.0, 155.86), control2: p(178.2, 179.79))
        return path
    }
}
