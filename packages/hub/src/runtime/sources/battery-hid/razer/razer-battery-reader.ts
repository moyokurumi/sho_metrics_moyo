import { setTimeout as wait } from "node:timers/promises";
import { readSystemVendorHidPeripheralIdentity, type ResolvedSystemPeripheralIdentity } from "../../../../settings/resolved-settings";
import { buildBatteryMetricKeyFromIdentity } from "../../battery/battery-metric-key";
import type { BatteryDeviceDiscoveryCandidate } from "../../battery/battery-device-discovery";
import type { NativeHidDevice, NativeHidDeviceInfo, NativeHidModule } from "../native-hid-loader-internal";
import type { VendorHidBatteryReader } from "../vendor-hid-battery-reader";
import { buildRazerBatteryRequest, parseRazerBatteryPercent } from "./razer-battery-protocol";

const VENDOR_ID = 0x1532;
const NAGA_V3_PRO_RECEIVER_PID = 0x00e8;
const DEVICE_NAME = "Razer Naga V3 Pro";
const MODEL_ID = "razer:naga-v3-pro";
const RESPONSE_DELAYS_MILLISECONDS = [8, 12, 17] as const;

type RazerBatteryRoute = NativeHidDeviceInfo & { readonly path: string };

function isRazerBatteryRoute(device: NativeHidDeviceInfo): device is RazerBatteryRoute {
    // MI_03 is the control endpoint. Never open MI_00/01/02 or a virtual collection.
    return device.vendorId === VENDOR_ID && device.productId === NAGA_V3_PRO_RECEIVER_PID
        && device.interface === 3 && device.usagePage === 1 && device.usage === 3
        && device.path !== undefined && /^\\\\\?\\hid#vid_1532&pid_00e8&mi_03#/iu.test(device.path);
}

function buildIdentity(route: RazerBatteryRoute): ResolvedSystemPeripheralIdentity {
    return {
        evidence: {
            kind: "vendorHid",
            vendorId: VENDOR_ID,
            productId: NAGA_V3_PRO_RECEIVER_PID,
            manufacturer: "Razer",
            productName: DEVICE_NAME,
            serialNumber: route.serialNumber,
            interfaceNumber: route.interface,
            usagePage: route.usagePage,
            usageId: route.usage,
            bindingTransport: "usbReceiver",
            receiverKind: "unknownReceiver",
            vendorUnitId: undefined,
            modelId: MODEL_ID,
            receiverSlot: undefined,
        },
    };
}

/** Reads the battery of the allowlisted Naga V3 Pro receiver on Windows. */
export class RazerBatteryReader implements VendorHidBatteryReader {
    private readonly routeByMetricKey = new Map<string, RazerBatteryRoute>();

    constructor(
        private readonly nativeHidModule: NativeHidModule,
        private readonly waitForResponse: (milliseconds: number) => Promise<void> = wait,
    ) {}

    async discoverBatteryDevices(devices: readonly NativeHidDeviceInfo[]): Promise<readonly BatteryDeviceDiscoveryCandidate[]> {
        this.routeByMetricKey.clear();
        const candidates: BatteryDeviceDiscoveryCandidate[] = [];
        const routes = devices.filter(isRazerBatteryRoute);
        for (const route of routes) {
            const candidate = await this.readRoute(route);
            if (candidate !== undefined) {
                candidates.push(candidate);
                if (routes.length === 1) {
                    this.routeByMetricKey.set(buildBatteryMetricKeyFromIdentity(candidate.identity), route);
                }
            }
        }
        return candidates;
    }

    async readBatteryDevice(metricKey: string): Promise<BatteryDeviceDiscoveryCandidate | undefined> {
        const route = this.routeByMetricKey.get(metricKey);
        return route === undefined ? undefined : this.readRoute(route);
    }

    async readBatteryDeviceFromIdentity(
        metricKey: string,
        identity: ResolvedSystemPeripheralIdentity,
        devices: readonly NativeHidDeviceInfo[],
    ): Promise<BatteryDeviceDiscoveryCandidate | undefined> {
        const evidence = readSystemVendorHidPeripheralIdentity(identity);
        if (evidence?.vendorId !== VENDOR_ID || evidence.productId !== NAGA_V3_PRO_RECEIVER_PID
            || evidence.modelId !== MODEL_ID || evidence.bindingTransport !== "usbReceiver") {
            return undefined;
        }

        const routes = devices.filter(isRazerBatteryRoute);
        const route = routes[0];
        if (routes.length !== 1 || route === undefined || buildBatteryMetricKeyFromIdentity(buildIdentity(route)) !== metricKey) {
            return undefined;
        }

        const candidate = await this.readRoute(route);
        if (candidate !== undefined) {
            this.routeByMetricKey.set(metricKey, route);
        }
        return candidate;
    }

    private async readRoute(route: RazerBatteryRoute): Promise<BatteryDeviceDiscoveryCandidate | undefined> {
        let device: NativeHidDevice | undefined;
        try {
            device = new this.nativeHidModule.HID(route.path, { nonExclusive: true });
            const batteryPercent = await this.readBatteryPercent(device);
            if (batteryPercent === undefined) {
                return undefined;
            }
            return {
                candidateId: "razer-naga-v3-pro-" + route.path.toLowerCase(),
                displayName: DEVICE_NAME,
                transport: "usbReceiver",
                receiverKind: "unknownReceiver",
                identity: buildIdentity(route),
                supportState: "experimental",
                isExperimental: true,
                batteryPercent,
                batteryTelemetryFreshness: "fresh",
                diagnostics: { sourcePathId: route.path },
            };
        } catch {
            // A powered-off mouse, unplugged receiver, or an exclusive vendor
            // handle must not block any other vendor's battery polling.
            return undefined;
        } finally {
            device?.close();
        }
    }

    private async readBatteryPercent(device: NativeHidDevice): Promise<number | undefined> {
        const request = buildRazerBatteryRequest();
        // The receiver shares its last response with Synapse. A 100 ms delay
        // consistently returned Synapse traffic; valid replies arrived at 3–17 ms.
        for (const delay of RESPONSE_DELAYS_MILLISECONDS) {
            if (device.sendFeatureReport(request) !== request.length) {
                return undefined;
            }
            await this.waitForResponse(delay);
            const response = device.getFeatureReport(0, request.length);
            const batteryPercent = parseRazerBatteryPercent(response);
            if (batteryPercent !== undefined) {
                return batteryPercent;
            }
            if (response[1] === 4 && response[2] === request[2]
                && response[7] === request[7] && response[8] === request[8]) {
                // Explicit timeout from the receiver: the mouse is offline.
                return undefined;
            }
        }
        return undefined;
    }
}
