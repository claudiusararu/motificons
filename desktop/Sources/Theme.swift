import SwiftUI

// Design-system color tokens. Hex values are the canon - do not restyle from taste.
enum Theme {
    static let ink = Color(red: 0x18 / 255, green: 0x31 / 255, blue: 0x53 / 255)          // #183153
    static let inkMuted = Color(red: 0x61 / 255, green: 0x6D / 255, blue: 0x8A / 255)     // #616D8A
    static let canvas = Color(red: 0xF0 / 255, green: 0xF1 / 255, blue: 0xF3 / 255)       // #F0F1F3
    static let surface = Color.white                                                       // #FFFFFF
    static let primary = Color(red: 0xFF / 255, green: 0xD4 / 255, blue: 0x3B / 255)      // #FFD43B
    static let cardShadow = Color(red: 0xC3 / 255, green: 0xC6 / 255, blue: 0xD1 / 255)   // #C3C6D1
    static let danger = Color(red: 0xC9 / 255, green: 0x2A / 255, blue: 0x2A / 255)       // #C92A2A
    static let teal = Color(red: 0x63 / 255, green: 0xE6 / 255, blue: 0xBE / 255)         // #63E6BE
    static let tealDeep = Color(red: 0x09 / 255, green: 0x92 / 255, blue: 0x68 / 255)     // #099268
    static let red = Color(red: 0xFF / 255, green: 0x87 / 255, blue: 0x87 / 255)          // #FF8787
    static let redDeep = Color(red: 0xE0 / 255, green: 0x31 / 255, blue: 0x31 / 255)      // #E03131
}
