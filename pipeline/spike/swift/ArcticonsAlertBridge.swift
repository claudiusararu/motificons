import SwiftUI

struct ArcticonsAlertBridge: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 48.0
        let vh = 48.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(13.843, 10.598))
        path.addLine(to: p(34.157, 10.598))
        path.addCurve(to: p(35.883, 12.324), control1: p(35.1102, 10.598), control2: p(35.883, 11.3708))
        path.addLine(to: p(35.883, 35.675))
        path.addCurve(to: p(34.157, 37.401), control1: p(35.883, 36.6282), control2: p(35.1102, 37.401))
        path.addLine(to: p(13.843, 37.401))
        path.addCurve(to: p(12.117, 35.675), control1: p(12.8898, 37.401), control2: p(12.117, 36.6282))
        path.addLine(to: p(12.117, 12.324))
        path.addCurve(to: p(13.843, 10.598), control1: p(12.117, 11.3708), control2: p(12.8898, 10.598))
        path.closeSubpath()
        path.move(to: p(32.398, 10.599))
        path.addLine(to: p(31.64, 5.242))
        path.addCurve(to: p(30.785, 4.5), control1: p(31.5809, 4.8155), control2: p(31.2156, 4.4984))
        path.addLine(to: p(17.215, 4.5))
        path.addCurve(to: p(16.361, 5.242), control1: p(16.7848, 4.4989), control2: p(16.42, 4.8159))
        path.addLine(to: p(15.602, 10.599))
        path.move(to: p(15.602, 37.402))
        path.addLine(to: p(16.36, 42.758))
        path.addCurve(to: p(17.215, 43.5), control1: p(16.4191, 43.1845), control2: p(16.7844, 43.5016))
        path.addLine(to: p(30.785, 43.5))
        path.addCurve(to: p(31.639, 42.758), control1: p(31.2152, 43.5011), control2: p(31.58, 43.1841))
        path.addLine(to: p(32.398, 37.401))
        path.move(to: p(30.672, 15.602))
        path.addLine(to: p(17.328, 15.602))
        path.addCurve(to: p(15.602, 17.328), control1: p(16.3748, 15.602), control2: p(15.602, 16.3748))
        path.addLine(to: p(15.602, 32.113))
        path.addLine(to: p(18.99, 28.725))
        path.addLine(to: p(30.672, 28.725))
        path.addCurve(to: p(31.8928, 28.2191), control1: p(31.1299, 28.725), control2: p(31.5691, 28.543))
        path.addCurve(to: p(32.398, 26.998), control1: p(32.2165, 27.8952), control2: p(32.3983, 27.4559))
        path.addLine(to: p(32.398, 17.328))
        path.addCurve(to: p(30.672, 15.602), control1: p(32.398, 16.3748), control2: p(31.6252, 15.602))
        path.move(to: p(19.765, 22.191))
        path.addCurve(to: p(20.515, 22.941), control1: p(19.765, 22.6052), control2: p(20.1008, 22.941))
        path.addCurve(to: p(21.265, 22.191), control1: p(20.9292, 22.941), control2: p(21.265, 22.6052))
        path.addCurve(to: p(20.515, 21.441), control1: p(21.265, 21.7768), control2: p(20.9292, 21.441))
        path.addCurve(to: p(19.765, 22.191), control1: p(20.1008, 21.441), control2: p(19.765, 21.7768))
        path.closeSubpath()
        path.move(to: p(23.25, 22.191))
        path.addCurve(to: p(24.0, 22.941), control1: p(23.25, 22.6052), control2: p(23.5858, 22.941))
        path.addCurve(to: p(24.75, 22.191), control1: p(24.4142, 22.941), control2: p(24.75, 22.6052))
        path.addCurve(to: p(24.0, 21.441), control1: p(24.75, 21.7768), control2: p(24.4142, 21.441))
        path.addCurve(to: p(23.25, 22.191), control1: p(23.5858, 21.441), control2: p(23.25, 21.7768))
        path.closeSubpath()
        path.move(to: p(26.735, 22.191))
        path.addCurve(to: p(27.485, 22.941), control1: p(26.735, 22.6052), control2: p(27.0708, 22.941))
        path.addCurve(to: p(28.235, 22.191), control1: p(27.8992, 22.941), control2: p(28.235, 22.6052))
        path.addCurve(to: p(27.485, 21.441), control1: p(28.235, 21.7768), control2: p(27.8992, 21.441))
        path.addCurve(to: p(26.735, 22.191), control1: p(27.0708, 21.441), control2: p(26.735, 21.7768))
        path.closeSubpath()
        return path
    }
}
