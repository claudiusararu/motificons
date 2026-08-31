import SwiftUI

struct IconParkACane: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 48.0
        let vh = 48.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(19.5576, 44.7684))
        path.addCurve(to: p(33.6417, 18.28), control1: p(19.5576, 44.7684), control2: p(32.468, 20.4873))
        path.addCurve(to: p(30.3899, 5.2252), control1: p(34.8154, 16.0726), control2: p(37.4535, 8.981))
        path.addCurve(to: p(17.7486, 9.8295), control1: p(23.3263, 1.4695), control2: p(19.1571, 7.1806))
        return path
    }
}
