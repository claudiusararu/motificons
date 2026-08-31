import SwiftUI

struct LucideArrowBigDownDash: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(14.0, 8.0))
        path.addCurve(to: p(15.0, 9.0), control1: p(14.5523, 8.0), control2: p(15.0, 8.4477))
        path.addLine(to: p(15.0, 11.0))
        path.addCurve(to: p(16.0, 12.0), control1: p(15.0, 11.5523), control2: p(15.4477, 12.0))
        path.addLine(to: p(19.293, 12.0))
        path.addCurve(to: p(19.9463, 12.4364), control1: p(19.579, 11.9999), control2: p(19.8369, 12.1722))
        path.addCurve(to: p(19.793, 13.207), control1: p(20.0558, 12.7007), control2: p(19.9953, 13.0048))
        path.addLine(to: p(12.854, 20.146))
        path.addCurve(to: p(12.0, 20.5), control1: p(12.6276, 20.3727), control2: p(12.3204, 20.5))
        path.addCurve(to: p(11.146, 20.146), control1: p(11.6796, 20.5), control2: p(11.3724, 20.3727))
        path.addLine(to: p(4.206, 13.206))
        path.addCurve(to: p(4.0538, 12.4362), control1: p(4.0044, 13.0037), control2: p(3.9444, 12.7))
        path.addCurve(to: p(4.706, 12.0), control1: p(4.1631, 12.1724), control2: p(4.4204, 12.0003))
        path.addLine(to: p(8.0, 12.0))
        path.addCurve(to: p(9.0, 11.0), control1: p(8.5523, 12.0), control2: p(9.0, 11.5523))
        path.addLine(to: p(9.0, 9.0))
        path.addCurve(to: p(10.0, 8.0), control1: p(9.0, 8.4477), control2: p(9.4477, 8.0))
        path.closeSubpath()
        path.move(to: p(9.0, 4.0))
        path.addLine(to: p(15.0, 4.0))
        return path
    }
}
