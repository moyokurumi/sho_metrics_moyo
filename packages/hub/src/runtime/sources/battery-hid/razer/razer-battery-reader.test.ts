import { describe, expect, it, vi } from "vitest";
import { buildBatteryMetricKeyFromIdentity } from "../../battery/battery-metric-key";
import type { NativeHidDeviceInfo } from "../native-hid-loader-internal";
import { buildRazerBatteryRequest, parseRazerBatteryPercent } from "./razer-battery-protocol";
import { RazerBatteryReader } from "./razer-battery-reader";

const receiver: NativeHidDeviceInfo = {
    release: 0,
    vendorId: 0x1532,
    productId: 0x00e8,
    interface: 3,
    usagePage: 1,
    usage: 3,
    path: String.raw`\\?\hid#vid_1532&pid_00e8&mi_03#receiver-a`,
};

function batteryReport(rawPercent: number): number[] {
    const report = buildRazerBatteryRequest();
    report[1] = 2;
    report[10] = rawPercent;
    report[89] = 0x85 ^ rawPercent;
    return report;
}

function buildTestReader(getFeatureReport = vi.fn(() => batteryReport(128))) {
    const sendFeatureReport = vi.fn((request: number[]) => request.length);
    const close = vi.fn();
    const open = vi.fn();
    const waitForResponse = vi.fn(async () => undefined);
    class TestHid {
        constructor(path: string) {
            open(path);
        }
        readonly close = close;
        readonly sendFeatureReport = sendFeatureReport;
        readonly getFeatureReport = getFeatureReport;
        readonly readTimeout = vi.fn(() => []);
        readonly write = vi.fn(() => 0);
    }
    return {
        reader: new RazerBatteryReader({ HID: TestHid, devices: () => [] }, waitForResponse),
        open,
        sendFeatureReport,
        getFeatureReport,
        waitForResponse,
        close,
    };
}

describe("Naga V3 Pro receiver battery", () => {
    it("constructs a GET-only feature report and reads 0 through 100 percent", () => {
        const request = buildRazerBatteryRequest();
        expect(request).toHaveLength(91);
        expect(request.slice(0, 9)).toEqual([0, 0, 0x1f, 0, 0, 0, 2, 7, 0x80]);
        expect(request.slice(9, 89)).toEqual(new Array<number>(80).fill(0));
        expect(request.slice(89)).toEqual([0x85, 0]);
        expect(parseRazerBatteryPercent(batteryReport(0))).toBe(0);
        expect(parseRazerBatteryPercent(batteryReport(255))).toBe(100);
    });

    it("rejects an offline receiver, wrong transaction, wrong command, invalid CRC, and short reports", () => {
        for (const [index, unexpected] of [[1, 4], [2, 0x3f], [8, 0x84], [89, 0]] as const) {
            const report = batteryReport(128);
            report[index] = unexpected;
            expect(parseRazerBatteryPercent(report)).toBeUndefined();
        }
        expect(parseRazerBatteryPercent(batteryReport(128).slice(0, 90))).toBeUndefined();
    });

    it("discovers only the receiver control interface and rereads a saved device on cold start", async () => {
        const fixture = buildTestReader();
        const inputCollection = { ...receiver, usage: 2, interface: 0 };
        const devices = [inputCollection, { ...receiver, productId: 0x00e7 }, receiver];
        const candidates = await fixture.reader.discoverBatteryDevices(devices);
        expect(candidates).toHaveLength(1);
        expect(fixture.open).toHaveBeenCalledExactlyOnceWith(receiver.path);
        expect(fixture.close).toHaveBeenCalledTimes(1);
        expect(fixture.sendFeatureReport).toHaveBeenCalledExactlyOnceWith(buildRazerBatteryRequest());
        expect(fixture.waitForResponse).toHaveBeenCalledTimes(1);
        expect(fixture.getFeatureReport).toHaveBeenCalledExactlyOnceWith(0, 91);
        const candidate = candidates[0];
        if (candidate === undefined) {
            throw new Error("Missing Razer candidate");
        }
        const metricKey = buildBatteryMetricKeyFromIdentity(candidate.identity);
        expect(candidate.batteryPercent).toBe(50);
        expect(await fixture.reader.readBatteryDevice(metricKey)).toEqual(candidate);
        const restarted = buildTestReader();
        expect(await restarted.reader.readBatteryDeviceFromIdentity(metricKey, candidate.identity, devices)).toEqual(candidate);
        expect(restarted.open).toHaveBeenCalledExactlyOnceWith(receiver.path);
    });

    it("retries when Synapse replaces the response", async () => {
        const unrelated = batteryReport(128);
        unrelated[7] = 15;
        const featureReport = vi.fn(() => batteryReport(235))
            .mockReturnValueOnce(unrelated);
        const fixture = buildTestReader(featureReport);
        const candidates = await fixture.reader.discoverBatteryDevices([receiver]);
        expect(candidates[0]?.batteryPercent).toBe(92);
        expect(fixture.waitForResponse.mock.calls).toHaveLength(2);
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });
    it("closes a failed handle and does not publish the receiver's offline value as 0%", async () => {
        const offline = batteryReport(0);
        offline[1] = 4;
        const fixture = buildTestReader(vi.fn(() => offline));
        expect(await fixture.reader.discoverBatteryDevices([receiver])).toEqual([]);
        expect(fixture.close).toHaveBeenCalledTimes(1);
    });
});
