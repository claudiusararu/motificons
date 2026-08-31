import SwiftUI

struct LucideAArrowDown: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(14.0, 12.0))
        path.addLine(to: p(18.0, 16.0))
        path.addLine(to: p(22.0, 12.0))
        path.move(to: p(18.0, 16.0))
        path.addLine(to: p(18.0, 7.0))
        path.move(to: p(2.0, 16.0))
        path.addLine(to: p(6.039, 6.31))
        path.addCurve(to: p(6.5005, 6.0024), control1: p(6.1167, 6.1237), control2: p(6.2987, 6.0024))
        path.addCurve(to: p(6.962, 6.31), control1: p(6.7023, 6.0024), control2: p(6.8843, 6.1237))
        path.addLine(to: p(11.0, 16.0))
        path.move(to: p(3.304, 13.0))
        path.addLine(to: p(9.696, 13.0))
        return path
    }
}
