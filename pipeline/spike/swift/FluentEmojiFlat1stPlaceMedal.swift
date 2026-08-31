import SwiftUI

struct FluentEmojiFlat1stPlaceMedal: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 32.0
        let vh = 32.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(18.768, 11.51))
        path.addLine(to: p(13.548, 2.93))
        path.addCurve(to: p(11.928, 2.0), control1: p(13.208, 2.35), control2: p(12.598, 2.0))
        path.addLine(to: p(5.338, 2.0))
        path.addCurve(to: p(3.688, 4.82), control1: p(3.888, 2.0), control2: p(2.978, 3.56))
        path.addCurve(to: p(9.118, 10.6), control1: p(5.0076, 7.1547), control2: p(6.8702, 9.1373))
        path.addCurve(to: p(11.788, 11.51), control1: p(9.878, 11.19), control2: p(10.818, 11.51))
        path.closeSubpath()
        path.move(to: p(26.658, 2.0))
        path.addLine(to: p(20.068, 2.0))
        path.addCurve(to: p(18.448, 2.93), control1: p(19.398, 2.0), control2: p(18.788, 2.35))
        path.addLine(to: p(13.228, 11.51))
        path.addLine(to: p(20.218, 11.51))
        path.addCurve(to: p(22.888, 10.6), control1: p(21.188, 11.51), control2: p(22.118, 11.19))
        path.addCurve(to: p(28.318, 4.82), control1: p(25.138, 9.14), control2: p(26.998, 7.16))
        path.addCurve(to: p(26.658, 2.0), control1: p(29.018, 3.56), control2: p(28.108, 2.0))
        path.move(to: p(15.99, 30.0))
        path.addCurve(to: p(26.03, 19.71), control1: p(21.535, 30.0), control2: p(26.03, 25.393))
        path.addCurve(to: p(15.99, 9.42), control1: p(26.03, 14.027), control2: p(21.535, 9.42))
        path.addCurve(to: p(5.95, 19.71), control1: p(10.445, 9.42), control2: p(5.95, 14.027))
        path.addCurve(to: p(15.99, 30.0), control1: p(5.95, 25.393), control2: p(10.445, 30.0))
        path.move(to: p(14.076, 16.041))
        path.addCurve(to: p(15.076, 15.041), control1: p(14.076, 15.4887), control2: p(14.5237, 15.041))
        path.addLine(to: p(16.0, 15.041))
        path.addCurve(to: p(17.0, 16.041), control1: p(16.5523, 15.041), control2: p(17.0, 15.4887))
        path.addLine(to: p(17.0, 23.0))
        path.addCurve(to: p(16.0, 24.0), control1: p(17.0, 23.5523), control2: p(16.5523, 24.0))
        path.addCurve(to: p(15.0, 23.0), control1: p(15.4477, 24.0), control2: p(15.0, 23.5523))
        path.addLine(to: p(15.0, 17.038))
        path.addCurve(to: p(14.076, 16.041), control1: p(14.4787, 16.9983), control2: p(14.0761, 16.5638))
        path.move(to: p(16.0, 28.76))
        path.addCurve(to: p(9.76, 26.11), control1: p(13.64, 28.76), control2: p(11.42, 27.82))
        path.addCurve(to: p(7.17, 19.71), control1: p(8.0895, 24.3997), control2: p(7.1591, 22.1007))
        path.addCurve(to: p(9.76, 13.31), control1: p(7.17, 17.29), control2: p(8.09, 15.02))
        path.addCurve(to: p(16.005, 10.6629), control1: p(11.3971, 11.6181), control2: p(13.6507, 10.6629))
        path.addCurve(to: p(22.25, 13.31), control1: p(18.3593, 10.6629), control2: p(20.6129, 11.6181))
        path.addCurve(to: p(22.25, 26.11), control1: p(25.69, 16.84), control2: p(25.69, 22.58))
        path.addCurve(to: p(16.0, 28.76), control1: p(20.57, 27.82), control2: p(18.35, 28.76))
        path.move(to: p(15.99, 11.89))
        path.addCurve(to: p(10.6, 14.18), control1: p(14.04, 11.89), control2: p(12.08, 12.65))
        path.addCurve(to: p(8.37, 19.71), control1: p(9.1601, 15.6595), control2: p(8.3592, 17.6455))
        path.addCurve(to: p(10.6, 25.24), control1: p(8.37, 21.8), control2: p(9.16, 23.76))
        path.addCurve(to: p(15.99, 27.53), control1: p(12.0108, 26.7042), control2: p(13.9568, 27.531))
        path.addCurve(to: p(21.38, 25.24), control1: p(18.03, 27.53), control2: p(19.94, 26.72))
        path.addCurve(to: p(21.38, 14.18), control1: p(24.35, 22.19), control2: p(24.35, 17.23))
        path.addCurve(to: p(15.99, 11.89), control1: p(19.9706, 12.7139), control2: p(18.0237, 11.8867))
        return path
    }
}
