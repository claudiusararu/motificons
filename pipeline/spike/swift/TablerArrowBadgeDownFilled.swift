import SwiftUI

struct TablerArrowBadgeDownFilled: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(16.375, 6.22))
        path.addLine(to: p(12.0, 9.718))
        path.addLine(to: p(7.625, 6.218))
        path.addCurve(to: p(6.5664, 6.0975), control1: p(7.3247, 5.9775), control2: p(6.913, 5.9307))
        path.addCurve(to: p(6.0, 7.0), control1: p(6.2197, 6.2644), control2: p(5.9995, 6.6153))
        path.addLine(to: p(6.0, 13.0))
        path.addCurve(to: p(6.375, 13.78), control1: p(6.0002, 13.3034), control2: p(6.1381, 13.5904))
        path.addLine(to: p(11.375, 17.78))
        path.addCurve(to: p(12.625, 17.78), control1: p(11.7403, 18.0725), control2: p(12.2597, 18.0725))
        path.addLine(to: p(17.625, 13.78))
        path.addCurve(to: p(18.0, 13.0), control1: p(17.8619, 13.5904), control2: p(17.9998, 13.3034))
        path.addLine(to: p(18.0, 7.0))
        path.addCurve(to: p(17.4327, 6.0991), control1: p(17.9998, 6.6156), control2: p(17.7792, 6.2654))
        path.addCurve(to: p(16.375, 6.22), control1: p(17.0862, 5.9328), control2: p(16.675, 5.9798))
        return path
    }
}
