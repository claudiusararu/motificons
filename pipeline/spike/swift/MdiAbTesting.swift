import SwiftUI

struct MdiAbTesting: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(4.0, 2.0))
        path.addCurve(to: p(2.0, 4.0), control1: p(2.8954, 2.0), control2: p(2.0, 2.8954))
        path.addLine(to: p(2.0, 12.0))
        path.addLine(to: p(4.0, 12.0))
        path.addLine(to: p(4.0, 8.0))
        path.addLine(to: p(6.0, 8.0))
        path.addLine(to: p(6.0, 12.0))
        path.addLine(to: p(8.0, 12.0))
        path.addLine(to: p(8.0, 4.0))
        path.addCurve(to: p(6.0, 2.0), control1: p(8.0, 2.8954), control2: p(7.1046, 2.0))
        path.closeSubpath()
        path.move(to: p(4.0, 4.0))
        path.addLine(to: p(6.0, 4.0))
        path.addLine(to: p(6.0, 6.0))
        path.addLine(to: p(4.0, 6.0))
        path.move(to: p(22.0, 15.5))
        path.addLine(to: p(22.0, 14.0))
        path.addCurve(to: p(20.0, 12.0), control1: p(22.0, 12.8954), control2: p(21.1046, 12.0))
        path.addLine(to: p(16.0, 12.0))
        path.addLine(to: p(16.0, 22.0))
        path.addLine(to: p(20.0, 22.0))
        path.addCurve(to: p(22.0, 20.0), control1: p(21.1046, 22.0), control2: p(22.0, 21.1046))
        path.addLine(to: p(22.0, 18.5))
        path.addCurve(to: p(20.5, 17.0), control1: p(21.979, 17.6804), control2: p(21.3196, 17.021))
        path.addCurve(to: p(22.0, 15.5), control1: p(21.3196, 16.979), control2: p(21.979, 16.3196))
        path.move(to: p(20.0, 20.0))
        path.addLine(to: p(18.0, 20.0))
        path.addLine(to: p(18.0, 18.0))
        path.addLine(to: p(20.0, 18.0))
        path.closeSubpath()
        path.move(to: p(20.0, 16.0))
        path.addLine(to: p(18.0, 16.0))
        path.addLine(to: p(18.0, 14.0))
        path.addLine(to: p(20.0, 14.0))
        path.move(to: p(5.79, 21.61))
        path.addLine(to: p(4.21, 20.39))
        path.addLine(to: p(18.21, 2.39))
        path.addLine(to: p(19.79, 3.61))
        path.closeSubpath()
        return path
    }
}
