import SwiftUI

struct CarbonAlignVerticalTop: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 32.0
        let vh = 32.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(24.0, 20.0))
        path.addLine(to: p(20.0, 20.0))
        path.addCurve(to: p(18.0, 18.0), control1: p(18.8954, 20.0), control2: p(18.0, 19.1046))
        path.addLine(to: p(18.0, 11.0))
        path.addCurve(to: p(20.0, 9.0), control1: p(18.0, 9.8954), control2: p(18.8954, 9.0))
        path.addLine(to: p(24.0, 9.0))
        path.addCurve(to: p(26.0, 11.0), control1: p(25.1046, 9.0), control2: p(26.0, 9.8954))
        path.addLine(to: p(26.0, 18.0))
        path.addCurve(to: p(24.0, 20.0), control1: p(26.0, 19.1046), control2: p(25.1046, 20.0))
        path.move(to: p(20.0, 11.0))
        path.addLine(to: p(20.0, 18.0))
        path.addLine(to: p(24.001, 18.0))
        path.addLine(to: p(24.0, 11.0))
        path.closeSubpath()
        path.move(to: p(12.0, 28.0))
        path.addLine(to: p(8.0, 28.0))
        path.addCurve(to: p(6.0, 26.0), control1: p(6.8954, 28.0), control2: p(6.0, 27.1046))
        path.addLine(to: p(6.0, 11.0))
        path.addCurve(to: p(8.0, 9.0), control1: p(6.0, 9.8954), control2: p(6.8954, 9.0))
        path.addLine(to: p(12.0, 9.0))
        path.addCurve(to: p(14.0, 11.0), control1: p(13.1046, 9.0), control2: p(14.0, 9.8954))
        path.addLine(to: p(14.0, 26.0))
        path.addCurve(to: p(12.0, 28.0), control1: p(14.0, 27.1046), control2: p(13.1046, 28.0))
        path.move(to: p(8.0, 11.0))
        path.addLine(to: p(8.0, 26.0))
        path.addLine(to: p(12.001, 26.0))
        path.addLine(to: p(12.0, 11.0))
        path.closeSubpath()
        path.move(to: p(2.0, 4.0))
        path.addLine(to: p(30.0, 4.0))
        path.addLine(to: p(30.0, 6.0))
        path.addLine(to: p(2.0, 6.0))
        path.closeSubpath()
        return path
    }
}
