import SwiftUI

struct IconParkAlignmentRightCenter: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 48.0
        let vh = 48.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(9.0, 6.0))
        path.addLine(to: p(39.0, 6.0))
        path.addCurve(to: p(42.0, 9.0), control1: p(40.6569, 6.0), control2: p(42.0, 7.3431))
        path.addLine(to: p(42.0, 39.0))
        path.addCurve(to: p(39.0, 42.0), control1: p(42.0, 40.6569), control2: p(40.6569, 42.0))
        path.addLine(to: p(9.0, 42.0))
        path.addCurve(to: p(6.0, 39.0), control1: p(7.3431, 42.0), control2: p(6.0, 40.6569))
        path.addLine(to: p(6.0, 9.0))
        path.addCurve(to: p(9.0, 6.0), control1: p(6.0, 7.3431), control2: p(7.3431, 6.0))
        path.closeSubpath()
        path.move(to: p(32.0, 30.0))
        path.addLine(to: p(36.0, 30.0))
        path.move(to: p(24.0, 24.0))
        path.addLine(to: p(36.0, 24.0))
        path.move(to: p(28.0, 18.0))
        path.addLine(to: p(36.0, 18.0))
        return path
    }
}
