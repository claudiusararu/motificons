import SwiftUI

struct MaterialSymbols10k: Shape {
    func path(in rect: CGRect) -> Path {
        let vw = 24.0
        let vh = 24.0
        let s = min(rect.width / vw, rect.height / vh)
        let ox = rect.minX + (rect.width - vw * s) / 2
        let oy = rect.minY + (rect.height - vh * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(6.0, 15.0))
        path.addLine(to: p(7.5, 15.0))
        path.addLine(to: p(7.5, 9.0))
        path.addLine(to: p(5.0, 9.0))
        path.addLine(to: p(5.0, 10.5))
        path.addLine(to: p(6.0, 10.5))
        path.closeSubpath()
        path.move(to: p(9.5, 15.0))
        path.addLine(to: p(12.0, 15.0))
        path.addQuadCurve(to: p(12.713, 14.712), control: p(12.425, 15.0))
        path.addQuadCurve(to: p(13.0, 14.0), control: p(13.001, 14.424))
        path.addLine(to: p(13.0, 10.0))
        path.addQuadCurve(to: p(12.712, 9.288), control: p(13.0, 9.575))
        path.addQuadCurve(to: p(12.0, 9.0), control: p(12.424, 9.001))
        path.addLine(to: p(9.5, 9.0))
        path.addQuadCurve(to: p(8.788, 9.288), control: p(9.075, 9.0))
        path.addQuadCurve(to: p(8.5, 10.0), control: p(8.501, 9.576))
        path.addLine(to: p(8.5, 14.0))
        path.addQuadCurve(to: p(8.788, 14.713), control: p(8.5, 14.425))
        path.addQuadCurve(to: p(9.5, 15.0), control: p(9.076, 15.001))
        path.move(to: p(10.0, 13.5))
        path.addLine(to: p(10.0, 10.5))
        path.addLine(to: p(11.5, 10.5))
        path.addLine(to: p(11.5, 13.5))
        path.closeSubpath()
        path.move(to: p(14.0, 15.0))
        path.addLine(to: p(15.5, 15.0))
        path.addLine(to: p(15.5, 12.75))
        path.addLine(to: p(17.25, 15.0))
        path.addLine(to: p(19.0, 15.0))
        path.addLine(to: p(16.75, 12.0))
        path.addLine(to: p(19.0, 9.0))
        path.addLine(to: p(17.25, 9.0))
        path.addLine(to: p(15.5, 11.25))
        path.addLine(to: p(15.5, 9.0))
        path.addLine(to: p(14.0, 9.0))
        path.closeSubpath()
        path.move(to: p(5.0, 21.0))
        path.addQuadCurve(to: p(3.588, 20.413), control: p(4.175, 21.0))
        path.addQuadCurve(to: p(3.0, 19.0), control: p(3.001, 19.826))
        path.addLine(to: p(3.0, 5.0))
        path.addQuadCurve(to: p(3.588, 3.588), control: p(3.0, 4.175))
        path.addQuadCurve(to: p(5.0, 3.0), control: p(4.176, 3.001))
        path.addLine(to: p(19.0, 3.0))
        path.addQuadCurve(to: p(20.413, 3.588), control: p(19.825, 3.0))
        path.addQuadCurve(to: p(21.0, 5.0), control: p(21.001, 4.176))
        path.addLine(to: p(21.0, 19.0))
        path.addQuadCurve(to: p(20.413, 20.413), control: p(21.0, 19.825))
        path.addQuadCurve(to: p(19.0, 21.0), control: p(19.826, 21.001))
        path.closeSubpath()
        return path
    }
}
