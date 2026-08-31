import SwiftUI

struct FeatherActivity: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(22.0, 12.0))
        path.addLine(to: p(18.0, 12.0))
        path.addLine(to: p(15.0, 21.0))
        path.addLine(to: p(9.0, 3.0))
        path.addLine(to: p(6.0, 12.0))
        path.addLine(to: p(2.0, 12.0))
        return path
    }
}
