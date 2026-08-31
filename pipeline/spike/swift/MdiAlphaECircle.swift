import SwiftUI

struct MdiAlphaECircle: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(12.0, 2.0))
        path.addCurve(to: p(22.0, 12.0), control1: p(17.5228, 2.0), control2: p(22.0, 6.4772))
        path.addCurve(to: p(12.0, 22.0), control1: p(22.0, 17.5228), control2: p(17.5228, 22.0))
        path.addCurve(to: p(2.0, 12.0), control1: p(6.4772, 22.0), control2: p(2.0, 17.5228))
        path.addCurve(to: p(12.0, 2.0), control1: p(2.0, 6.4772), control2: p(6.4772, 2.0))
        path.move(to: p(9.0, 7.0))
        path.addLine(to: p(9.0, 17.0))
        path.addLine(to: p(15.0, 17.0))
        path.addLine(to: p(15.0, 15.0))
        path.addLine(to: p(11.0, 15.0))
        path.addLine(to: p(11.0, 13.0))
        path.addLine(to: p(15.0, 13.0))
        path.addLine(to: p(15.0, 11.0))
        path.addLine(to: p(11.0, 11.0))
        path.addLine(to: p(11.0, 9.0))
        path.addLine(to: p(15.0, 9.0))
        path.addLine(to: p(15.0, 7.0))
        path.closeSubpath()
        return path
    }
}
