import SwiftUI

struct TablerAB: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(3.0, 16.0))
        path.addLine(to: p(3.0, 10.5))
        path.addCurve(to: p(5.5, 8.0), control1: p(3.0, 9.1193), control2: p(4.1193, 8.0))
        path.addCurve(to: p(8.0, 10.5), control1: p(6.8807, 8.0), control2: p(8.0, 9.1193))
        path.addLine(to: p(8.0, 16.0))
        path.move(to: p(8.0, 12.0))
        path.addLine(to: p(3.0, 12.0))
        path.move(to: p(12.0, 6.0))
        path.addLine(to: p(12.0, 18.0))
        path.move(to: p(16.0, 16.0))
        path.addLine(to: p(16.0, 8.0))
        path.addLine(to: p(19.0, 8.0))
        path.addCurve(to: p(21.0, 10.0), control1: p(20.1046, 8.0), control2: p(21.0, 8.8954))
        path.addCurve(to: p(19.0, 12.0), control1: p(21.0, 11.1046), control2: p(20.1046, 12.0))
        path.addLine(to: p(16.0, 12.0))
        path.move(to: p(19.0, 12.0))
        path.addCurve(to: p(21.0, 14.0), control1: p(20.1046, 12.0), control2: p(21.0, 12.8954))
        path.addCurve(to: p(19.0, 16.0), control1: p(21.0, 15.1046), control2: p(20.1046, 16.0))
        path.addLine(to: p(16.0, 16.0))
        return path
    }
}
