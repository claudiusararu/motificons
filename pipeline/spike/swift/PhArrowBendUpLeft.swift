import SwiftUI

struct PhArrowBendUpLeft: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 256.0
        let vh = 256.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(232.0, 200.0))
        path.addCurve(to: p(224.0, 208.0), control1: p(232.0, 204.4183), control2: p(228.4183, 208.0))
        path.addCurve(to: p(216.0, 200.0), control1: p(219.5817, 208.0), control2: p(216.0, 204.4183))
        path.addCurve(to: p(128.0, 112.0), control1: p(215.9449, 151.4218), control2: p(176.5782, 112.0551))
        path.addLine(to: p(51.31, 112.0))
        path.addLine(to: p(85.66, 146.34))
        path.addCurve(to: p(85.66, 157.66), control1: p(88.7859, 149.4659), control2: p(88.7859, 154.5341))
        path.addCurve(to: p(74.34, 157.66), control1: p(82.5341, 160.7859), control2: p(77.4659, 160.7859))
        path.addLine(to: p(26.34, 109.66))
        path.addCurve(to: p(23.9937, 104.0), control1: p(24.8378, 108.1595), control2: p(23.9937, 106.1233))
        path.addCurve(to: p(26.34, 98.34), control1: p(23.9937, 101.8767), control2: p(24.8378, 99.8405))
        path.addLine(to: p(74.34, 50.34))
        path.addCurve(to: p(85.66, 50.34), control1: p(77.4659, 47.2141), control2: p(82.5341, 47.2141))
        path.addCurve(to: p(85.66, 61.66), control1: p(88.7859, 53.4659), control2: p(88.7859, 58.5341))
        path.addLine(to: p(51.31, 96.0))
        path.addLine(to: p(128.0, 96.0))
        path.addCurve(to: p(232.0, 200.0), control1: p(185.4125, 96.0606), control2: p(231.9394, 142.5875))
        return path
    }
}
