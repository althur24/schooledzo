import { NextResponse } from 'next/server';
import katex from 'katex';

export async function GET() {
    const tests = [
      "$4\\sqrt{13}$",
      "4\\sqrt{13}",
      "$\\sqrt{13}$",
      "\\\\sqrt{13}",
      "$\\sqrt{13}$",
      "$4\\\\sqrt{13}$",
      "4\\\\sqrt{13}"
    ];

    const renderLatexInText = (text: string) => {
        // First handle block math ($$...$$)
        let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
            let cleanExpr = expr.replace(/(?<!\\)\\(?:\s*[\n\r]|\s*\\n)/g, '\\\\ ');
            try {
                const rendered = katex.renderToString(cleanExpr.trim(), { displayMode: true, throwOnError: false, trust: true });
                return `BLOCK: ${rendered}`;
            } catch (e) {
                return `ERR: ${e}`;
            }
        });

        // Then handle inline math ($...$)
        result = result.replace(/\$((?:[^\$]|\\\$)+?)\$/g, (_, expr) => {
            let cleanExpr = expr.replace(/(?<!\\)\\(?:\s*[\n\r]|\s*\\n)/g, '\\\\ ');
            try {
                const rendered = katex.renderToString(cleanExpr.trim(), { displayMode: false, throwOnError: false, trust: true });
                return `INLINE: ${rendered}`;
            } catch (e: any) {
                return `ERR: ${e.message}`;
            }
        });

        return result;
    }

    const results = tests.map(t => ({
        input: t,
        output: renderLatexInText(t)
    }));

    return NextResponse.json(results);
}
