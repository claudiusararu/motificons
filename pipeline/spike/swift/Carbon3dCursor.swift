import SwiftUI

struct Carbon3dCursor: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 32.0
        let vh = 32.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(13.0, 4.0))
        path.addLine(to: p(4.0, 4.0))
        path.addLine(to: p(4.0, 13.01))
        path.addLine(to: p(6.0, 13.01))
        path.addLine(to: p(6.0, 6.0))
        path.addLine(to: p(13.0, 6.0))
        path.addLine(to: p(13.0, 4.0))
        path.closeSubpath()
        path.move(to: p(29.49, 13.12))
        path.addLine(to: p(20.49, 8.12))
        path.addCurve(to: p(19.49, 8.12), control1: p(20.1806, 7.9414), control2: p(19.7994, 7.9414))
        path.addLine(to: p(10.49, 13.12))
        path.addCurve(to: p(10.0, 14.0), control1: p(10.1801, 13.3037), control2: p(9.9929, 13.6398))
        path.addLine(to: p(10.0, 24.0))
        path.addCurve(to: p(10.52, 24.87), control1: p(10.0026, 24.3629), control2: p(10.2017, 24.6958))
        path.addLine(to: p(19.52, 29.87))
        path.addCurve(to: p(20.0, 30.0), control1: p(19.6665, 29.9531), control2: p(19.8316, 29.9978))
        path.addCurve(to: p(20.49, 29.87), control1: p(20.1715, 29.9973), control2: p(20.3397, 29.9527))
        path.addLine(to: p(29.49, 24.87))
        path.addCurve(to: p(30.0, 24.0), control1: p(29.8045, 24.6932), control2: p(29.9994, 24.3608))
        path.addLine(to: p(30.0, 14.0))
        path.addCurve(to: p(29.49, 13.12), control1: p(30.003, 13.6357), control2: p(29.8076, 13.2985))
        path.closeSubpath()
        path.move(to: p(19.0, 27.3))
        path.addLine(to: p(12.0, 23.41))
        path.addLine(to: p(12.0, 15.69))
        path.addLine(to: p(19.0, 19.58))
        path.closeSubpath()
        path.move(to: p(20.0, 17.85))
        path.addLine(to: p(13.06, 14.0))
        path.addLine(to: p(20.0, 10.14))
        path.addLine(to: p(26.94, 14.0))
        path.closeSubpath()
        path.move(to: p(28.0, 23.41))
        path.addLine(to: p(21.0, 27.3))
        path.addLine(to: p(21.0, 19.58))
        path.addLine(to: p(28.0, 15.69))
        path.closeSubpath()
        return path
    }
}
