// Power GET report framing follows OpenRazer and the MIT-licensed razer-battery:
// https://github.com/andrzej-zuralovic/razer-battery/blob/main/src/protocol.rs
// Naga V3 Pro HyperSpeed uses transaction 0x1f and USB interface 03:
// https://github.com/SorcRR/MacRazer/issues/33
// https://github.com/openrazer/openrazer/pull/2904
const REPORT_LENGTH = 91; // Report ID 0 + 90-byte payload
const TRANSACTION_ID = 0x1f;
const POWER_COMMAND_CLASS = 0x07;
const READ_BATTERY_COMMAND = 0x80;
const ARGUMENT_LENGTH = 2;
const CHECKSUM_INDEX = 89;

function checksum(report: readonly number[]): number {
    return report.slice(3, CHECKSUM_INDEX).reduce((checksum, byte) => checksum ^ byte, 0);
}

export function buildRazerBatteryRequest(): number[] {
    const report = new Array<number>(REPORT_LENGTH).fill(0);
    report[2] = TRANSACTION_ID;
    report[6] = ARGUMENT_LENGTH;
    report[7] = POWER_COMMAND_CLASS;
    report[8] = READ_BATTERY_COMMAND;
    report[CHECKSUM_INDEX] = checksum(report);
    return report;
}

export function parseRazerBatteryPercent(report: readonly number[]): number | undefined {
    const rawPercent = report[10];
    if (report.length !== REPORT_LENGTH || report[0] !== 0
        || report[1] !== 0x02 || report[2] !== TRANSACTION_ID
        || report[3] !== 0 || report[4] !== 0 || report[5] !== 0
        || report[6] !== ARGUMENT_LENGTH || report[7] !== POWER_COMMAND_CLASS
        || report[8] !== READ_BATTERY_COMMAND || report[CHECKSUM_INDEX] !== checksum(report)
        || rawPercent === undefined || !Number.isInteger(rawPercent) || rawPercent < 0 || rawPercent > 255) {
        return undefined;
    }
    return Math.round(rawPercent * 100 / 255);
}
