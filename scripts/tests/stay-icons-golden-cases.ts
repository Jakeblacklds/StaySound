import { drawStayIcon, KINDS } from '../../web/src/icons/stayIcons';
import { RecordingPen } from '../../web/src/icons/pens';

/** Poses that exercise rest, held, the spring's overshoot and the flourish's beats, with state off and on. */
export const poses: Array<[press: number, flourish: number, state: number]> = [
    [0, 1, 0], [1, 1, 0], [-0.35, 1, 1], [0, 0.1, 1], [0, 0.3, 0.5], [0, 0.6, 1],
];

/** `# kind press flourish state` headers, each followed by the pen calls the TypeScript catalogue makes. */
export function generate(): string {
    const lines: string[] = [];
    for (const kind of KINDS) {
        for (const [press, flourish, state] of poses) {
            const pen = new RecordingPen();
            drawStayIcon(pen, kind, press, flourish, state);
            lines.push(`# ${kind} ${press} ${flourish} ${state}`, ...pen.ops);
        }
    }
    return lines.join('\n') + '\n';
}
