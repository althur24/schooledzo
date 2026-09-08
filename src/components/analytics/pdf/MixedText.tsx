'use client'

import { Text, StyleSheet } from '@react-pdf/renderer'
import { splitScripts } from './scriptSplit'

interface MixedTextStyle {
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
    color?: string
    lineHeight?: number
    textAlign?: string
    paddingTop?: number
    marginTop?: number
}

/**
 * <Text> yang otomatis memilih font Arab (NotoNaskhArabic) untuk segmen teks
 * Arab dan Latin (diwarisi dari parent) untuk sisanya. Dipakai untuk teks bebas
 * yang bisa berisi bahasa Arab (soal, judul, nama siswa/guru).
 */
export default function MixedText({ text, style }: { text: string; style?: MixedTextStyle | MixedTextStyle[] }) {
    const segs = splitScripts(text)
    if (segs.length === 1 && !segs[0].arabic) {
        return <Text style={style as any}>{text}</Text>
    }
    return (
        <Text style={style as any}>
            {segs.map((s, i) => (
                <Text
                    key={i}
                    style={s.arabic ? styles.arabic : undefined}
                >
                    {s.text}
                </Text>
            ))}
        </Text>
    )
}

const styles = StyleSheet.create({
    arabic: {
        fontFamily: 'NotoNaskhArabic',
    },
})
