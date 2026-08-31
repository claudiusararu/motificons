import SwiftUI

struct MeteoconsMoonNewFill: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 512.0
        let vh = 512.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(384.0, 256.0))
        path.addCurve(to: p(256.0, 128.0), control1: p(384.0, 185.3076), control2: p(326.6924, 128.0))
        path.addCurve(to: p(256.0, 384.0), control1: p(86.2, 134.7), control2: p(86.3, 377.3))
        path.addCurve(to: p(384.0, 256.0), control1: p(326.6924, 384.0), control2: p(384.0, 326.6924))
        return path
    }
}
