import SwiftUI

struct Arcticons001Taxis: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 48.0
        let vh = 48.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(33.434, 19.954))
        path.addLine(to: p(36.48, 18.441))
        path.addLine(to: p(34.52, 29.559))
        path.move(to: p(32.52, 29.559))
        path.addLine(to: p(36.52, 29.559))
        path.move(to: p(25.25, 29.56))
        path.addCurve(to: p(22.217, 25.876), control1: p(23.217, 29.56), control2: p(21.859, 27.91))
        path.addLine(to: p(22.879, 22.124))
        path.addCurve(to: p(27.211, 18.441), control1: p(23.238, 20.09), control2: p(25.177, 18.441))
        path.addLine(to: p(27.211, 18.441))
        path.addCurve(to: p(30.245, 22.124), control1: p(29.246, 18.441), control2: p(30.604, 20.09))
        path.addLine(to: p(29.583, 25.876))
        path.addCurve(to: p(25.251, 29.559), control1: p(29.225, 27.91), control2: p(27.285, 29.559))
        path.move(to: p(14.571, 29.56))
        path.addCurve(to: p(11.538, 25.876), control1: p(12.537, 29.56), control2: p(11.179, 27.91))
        path.addLine(to: p(12.199, 22.124))
        path.addCurve(to: p(16.532, 18.441), control1: p(12.559, 20.09), control2: p(14.498, 18.441))
        path.addLine(to: p(16.532, 18.441))
        path.addCurve(to: p(19.566, 22.124), control1: p(18.566, 18.441), control2: p(19.924, 20.09))
        path.addLine(to: p(18.904, 25.876))
        path.addCurve(to: p(14.571, 29.559), control1: p(18.545, 27.91), control2: p(16.606, 29.559))
        path.move(to: p(2.5, 24.0))
        path.addCurve(to: p(24.0, 36.0), control1: p(2.5, 30.6274), control2: p(12.1259, 36.0))
        path.addCurve(to: p(45.5, 24.0), control1: p(35.8741, 36.0), control2: p(45.5, 30.6274))
        path.addCurve(to: p(24.0, 12.0), control1: p(45.5, 17.3726), control2: p(35.8741, 12.0))
        path.addCurve(to: p(2.5, 24.0), control1: p(12.1259, 12.0), control2: p(2.5, 17.3726))
        path.closeSubpath()
        return path
    }
}
