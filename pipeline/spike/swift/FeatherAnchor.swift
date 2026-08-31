import SwiftUI

struct FeatherAnchor: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(9.0, 5.0))
        path.addCurve(to: p(12.0, 8.0), control1: p(9.0, 6.6569), control2: p(10.3431, 8.0))
        path.addCurve(to: p(15.0, 5.0), control1: p(13.6569, 8.0), control2: p(15.0, 6.6569))
        path.addCurve(to: p(12.0, 2.0), control1: p(15.0, 3.3431), control2: p(13.6569, 2.0))
        path.addCurve(to: p(9.0, 5.0), control1: p(10.3431, 2.0), control2: p(9.0, 3.3431))
        path.closeSubpath()
        path.move(to: p(12.0, 22.0))
        path.addLine(to: p(12.0, 8.0))
        path.move(to: p(5.0, 12.0))
        path.addLine(to: p(2.0, 12.0))
        path.addCurve(to: p(12.0, 22.0), control1: p(2.0, 17.5228), control2: p(6.4772, 22.0))
        path.addCurve(to: p(22.0, 12.0), control1: p(17.5228, 22.0), control2: p(22.0, 17.5228))
        path.addLine(to: p(19.0, 12.0))
        return path
    }
}
