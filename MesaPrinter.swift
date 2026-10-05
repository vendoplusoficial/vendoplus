import Foundation
import Capacitor
import CoreBluetooth
import Network

/*
 MesaPrinter — puente nativo de iOS para la impresora térmica.

 Implementa EXACTAMENTE el contrato que usa index.html:

   MesaPrinter.scan({ type })                   -> { devices: [{ id, name, rssi, likely }] }
   MesaPrinter.connect({ id, type, host, port }) -> { connected: Bool }
   MesaPrinter.disconnect()                     -> { ok: true }
   MesaPrinter.write({ data })                  -> { ok: true }   (data = base64, ESC/POS)
   MesaPrinter.netProbe({ host, port })         -> { ok: Bool }
   MesaPrinter.netPrint({ host, port, data })   -> { ok: true }
   evento "printerDisconnected"                 (la impresora se apagó o se alejó)

 En cuanto este plugin existe, "Mi cuenta -> Impresión de tickets" lo detecta
 solo y deja de usar Web Bluetooth. No hay que tocar el HTML.

 Qué corrige esta versión:
   · Ya no falla "Enciende el Bluetooth" al abrir la app: espera a que iOS
     termine de prender el Bluetooth (al arrancar el estado es "desconocido").
   · Reconectar sin volver a buscar: si la impresora ya está conectada, contesta
     al instante; si no, la abre por su identificador guardado.
   · Ya no se queda colgado: tiempo límite al conectar, al escribir y en Wi-Fi.
   · Si la impresora se apaga mientras conecta, contesta con error (antes nunca).
   · Escoge el canal de impresión correcto (2AF1, FF02, FFE1, ISSC…) en vez del
     primero que se deje escribir.
   · Envía con control de flujo (canSendWriteWithoutResponse / acuse de cada
     paquete) y sin congelar la pantalla (antes usaba Thread.sleep).
   · Encuentra impresoras que ya están conectadas al iPhone (esas no se anuncian)
     y las que no mandan nombre pero sí un servicio de impresora.

 En Info.plist hace falta:
   NSBluetoothAlwaysUsageDescription  = "Para imprimir tickets en tu impresora Bluetooth."
   NSLocalNetworkUsageDescription     = "Para imprimir tickets en tu impresora Wi-Fi."
 Opcional, para que la conexión aguante con la app en segundo plano:
   UIBackgroundModes -> bluetooth-central

 LÍMITE REAL DE iOS, sin rodeos:
   · CoreBluetooth habla SOLO con BLE / GATT.
   · Si la impresora es Bluetooth clásico (SPP) y NO es MFi, ni este plugin ni
     ningún otro la pueden abrir: Apple no expone SPP a apps normales. Para esas
     la salida real es Wi-Fi (netPrint, puerto 9100) o cambiar a un modelo BLE.
   · Si el modelo SÍ es MFi, se usa ExternalAccessory en vez de CoreBluetooth y
     hay que declarar su protocolo en UISupportedExternalAccessoryProtocols.
*/

@objc(MesaPrinter)
public class MesaPrinter: CAPPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {

    // Servicios que anuncian las térmicas ESC/POS BLE más comunes (en orden de preferencia).
    private let servicios: [CBUUID] = [
        CBUUID(string: "18F0"),
        CBUUID(string: "FF00"),
        CBUUID(string: "FFE0"),
        CBUUID(string: "FFF0"),
        CBUUID(string: "FFE5"),
        CBUUID(string: "FFB0"),
        CBUUID(string: "FEE7"),
        CBUUID(string: "AE30"),
        CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455"),
        CBUUID(string: "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"),
        CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    ]
    // Canales de escritura conocidos: se prefieren sobre cualquier otro.
    private let canalesConocidos: [CBUUID] = [
        CBUUID(string: "2AF1"),
        CBUUID(string: "FF02"),
        CBUUID(string: "FFE1"),
        CBUUID(string: "FFF2"),
        CBUUID(string: "FFE9"),
        CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3"),
        CBUUID(string: "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F"),
        CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"),
        CBUUID(string: "AE01")
    ]

    private var central: CBCentralManager!
    private var esperandoBT: [(Bool) -> Void] = []

    // Buscar
    private var encontrados: [String: CBPeripheral] = [:]
    private var nombres: [String: String] = [:]
    private var senal: [String: Int] = [:]
    private var pareceImpresora: [String: Bool] = [:]
    private var llamadaScan: CAPPluginCall?

    // Conectar
    private var activa: CBPeripheral?
    private var canal: CBCharacteristic?
    private var sinRespuesta = false
    private var llamadaConnect: CAPPluginCall?
    private var serviciosPendientes = 0
    private var cerrandoAMano = false
    private var relojConnect: DispatchWorkItem?

    // Escribir
    private var cola: [Data] = []
    private var llamadaWrite: CAPPluginCall?
    private var esperandoAcuse = false
    private var relojWrite: DispatchWorkItem?

    override public func load() {
        central = CBCentralManager(delegate: self, queue: .main, options: [
            CBCentralManagerOptionShowPowerAlertKey: true
        ])
    }

    // MARK: - Esperar a que el Bluetooth esté listo

    /// Al abrir la app el estado es .unknown unos instantes: se espera hasta 4 s.
    private func conBluetooth(_ call: CAPPluginCall, _ listo: @escaping () -> Void) {
        switch central.state {
        case .poweredOn:
            listo()
        case .unauthorized:
            call.reject("Dale permiso de Bluetooth a la app en Ajustes > Privacidad > Bluetooth.")
        case .unsupported:
            call.reject("Este aparato no tiene Bluetooth BLE.")
        case .poweredOff:
            call.reject("Prende el Bluetooth del iPhone y vuelve a intentar.")
        default:
            var hecho = false
            esperandoBT.append { ok in
                if hecho { return }
                hecho = true
                if ok { listo() } else { call.reject("Prende el Bluetooth del iPhone y vuelve a intentar.") }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self = self, !hecho else { return }
                hecho = true
                if self.central.state == .poweredOn { listo() }
                else { call.reject("El Bluetooth no está listo. Revisa que esté prendido y que la app tenga permiso.") }
            }
        }
    }

    public func centralManagerDidUpdateState(_ c: CBCentralManager) {
        if c.state == .unknown || c.state == .resetting { return }
        let pendientes = esperandoBT
        esperandoBT.removeAll()
        pendientes.forEach { $0(c.state == .poweredOn) }
        if c.state != .poweredOn, activa != nil {
            if llamadaConnect != nil {
                terminarConnect(ok: false, motivo: "Se apagó el Bluetooth del iPhone.")
                return
            }
            limpiarConexion()
            notifyListeners("printerDisconnected", data: [:])
        }
    }

    // MARK: - Buscar

    @objc func scan(_ call: CAPPluginCall) {
        if (call.getString("type") ?? "bt") != "bt" {
            call.resolve(["devices": []])
            return
        }
        conBluetooth(call) { [weak self] in
            guard let self = self else { return }
            // Si había otra búsqueda abierta, se le contesta con lo que lleve
            self.terminarScan()
            self.encontrados.removeAll()
            self.nombres.removeAll()
            self.senal.removeAll()
            self.pareceImpresora.removeAll()
            self.llamadaScan = call

            // Las impresoras YA conectadas al iPhone no se anuncian: se agregan aquí.
            for p in self.central.retrieveConnectedPeripherals(withServices: self.servicios) {
                let id = p.identifier.uuidString
                self.encontrados[id] = p
                self.nombres[id] = p.name ?? "Impresora Bluetooth"
                self.pareceImpresora[id] = true
            }
            if let p = self.activa {
                let id = p.identifier.uuidString
                self.encontrados[id] = p
                self.nombres[id] = p.name ?? self.nombres[id] ?? "Impresora Bluetooth"
                self.pareceImpresora[id] = true
            }

            // nil = ver todo lo que se anuncie: muchas térmicas no publican su servicio.
            self.central.scanForPeripherals(withServices: nil, options: [
                CBCentralManagerScanOptionAllowDuplicatesKey: false
            ])
            DispatchQueue.main.asyncAfter(deadline: .now() + 7) { [weak self] in
                guard let self = self, self.llamadaScan === call else { return }
                self.terminarScan()
            }
        }
    }

    private func terminarScan() {
        guard let call = llamadaScan else { return }
        llamadaScan = nil
        central.stopScan()
        let lista = encontrados.keys.map { id -> [String: Any] in
            [
                "id": id,
                "name": nombres[id] ?? "Impresora Bluetooth",
                "rssi": senal[id] ?? 0,
                "likely": pareceImpresora[id] ?? false
            ]
        }
        call.resolve(["devices": lista])
    }

    public func centralManager(_ c: CBCentralManager,
                               didDiscover p: CBPeripheral,
                               advertisementData d: [String: Any],
                               rssi RSSI: NSNumber) {
        let id = p.identifier.uuidString
        let anunciados = (d[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
            + (d[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
        let esServicioImpresora = anunciados.contains { servicios.contains($0) }
        let nombre = (d[CBAdvertisementDataLocalNameKey] as? String) ?? p.name
        // Sin nombre y sin servicio de impresora casi siempre es ruido (balizas, relojes ajenos).
        if (nombre ?? "").trimmingCharacters(in: .whitespaces).isEmpty && !esServicioImpresora { return }
        encontrados[id] = p
        nombres[id] = (nombre?.isEmpty == false ? nombre! : "Impresora Bluetooth")
        let r = RSSI.intValue
        if r != 127 { senal[id] = r }
        pareceImpresora[id] = esServicioImpresora || (pareceImpresora[id] ?? false)
    }

    // MARK: - Conectar

    @objc func connect(_ call: CAPPluginCall) {
        let tipo = call.getString("type") ?? "bt"
        if tipo == "wifi" {
            let host = call.getString("host") ?? ""
            let port = call.getInt("port") ?? 9100
            probar(host: host, port: port) { ok in call.resolve(["connected": ok]) }
            return
        }
        guard let id = call.getString("id"), let uuid = UUID(uuidString: id) else {
            call.reject("Falta el identificador de la impresora")
            return
        }
        conBluetooth(call) { [weak self] in
            guard let self = self else { return }

            // ¿Ya está conectada y lista? Contesta al instante (volver a la app, recargar la página).
            if let p = self.activa, p.identifier == uuid, p.state == .connected, self.canal != nil {
                call.resolve(["connected": true])
                return
            }
            // Otra conexión a medias: se cancela con error
            if let previa = self.llamadaConnect {
                self.llamadaConnect = nil
                previa.reject("Se empezó otra conexión")
            }
            let candidato = self.encontrados[id]
                ?? self.central.retrievePeripherals(withIdentifiers: [uuid]).first
                ?? self.central.retrieveConnectedPeripherals(withServices: self.servicios).first(where: { $0.identifier == uuid })
            guard let p = candidato else {
                call.reject("No encontramos esa impresora. Préndela, acércala y búscala otra vez.")
                return
            }
            // Si había otra impresora abierta, se suelta
            if let otra = self.activa, otra.identifier != uuid {
                self.cerrandoAMano = true
                self.central.cancelPeripheralConnection(otra)
            }
            self.llamadaConnect = call
            self.activa = p
            self.canal = nil
            p.delegate = self

            self.relojConnect?.cancel()
            let reloj = DispatchWorkItem { [weak self] in
                self?.terminarConnect(ok: false, motivo: "La impresora no contestó. Revisa que esté prendida y cerca.")
            }
            self.relojConnect = reloj
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: reloj)

            if p.state == .connected {
                self.descubrir(p)
            } else {
                self.central.connect(p, options: nil)
            }
        }
    }

    private func descubrir(_ p: CBPeripheral) {
        if let servs = p.services, !servs.isEmpty {
            // Ya se conocían (reconexión): se revisan sin volver a pedirlos.
            serviciosPendientes = servs.count
            servs.forEach { s in
                if s.characteristics != nil { self.peripheral(p, didDiscoverCharacteristicsFor: s, error: nil) }
                else { p.discoverCharacteristics(nil, for: s) }
            }
        } else {
            p.discoverServices(nil)
        }
    }

    public func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        guard p == activa else { return }
        descubrir(p)
    }

    public func centralManager(_ c: CBCentralManager,
                               didFailToConnect p: CBPeripheral, error: Error?) {
        guard p == activa else { return }
        terminarConnect(ok: false, motivo: error?.localizedDescription ?? "No se pudo conectar")
    }

    public func centralManager(_ c: CBCentralManager,
                               didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        let aMano = cerrandoAMano
        cerrandoAMano = false
        guard p == activa else { return }
        if llamadaConnect != nil {
            terminarConnect(ok: false, motivo: "La impresora se desconectó mientras se conectaba.")
            return
        }
        limpiarConexion()
        // Avisar a la página para que diga "Desconectada" y se reconecte sola
        if !aMano { notifyListeners("printerDisconnected", data: [:]) }
    }

    public func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let servs = p.services, !servs.isEmpty else {
            terminarConnect(ok: false, motivo: "La impresora no expone servicios BLE. Si es Bluetooth clásico, en iPhone usa Wi-Fi.")
            return
        }
        serviciosPendientes = servs.count
        servs.forEach { p.discoverCharacteristics(nil, for: $0) }
    }

    public func peripheral(_ p: CBPeripheral,
                           didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        guard llamadaConnect != nil else { return }
        serviciosPendientes = max(0, serviciosPendientes - 1)

        // ¿Ya apareció un canal conocido? Se usa de una vez.
        if let mejor = mejorCanal(p), canalesConocidos.contains(mejor.uuid) {
            usar(mejor)
            return
        }
        // Se revisaron todos los servicios: el mejor que haya
        if serviciosPendientes == 0 {
            if let mejor = mejorCanal(p) { usar(mejor) }
            else { terminarConnect(ok: false, motivo: "La impresora no tiene un canal para recibir datos por BLE.") }
        }
    }

    private func mejorCanal(_ p: CBPeripheral) -> CBCharacteristic? {
        var mejor: CBCharacteristic?
        var puntos = -1
        for s in p.services ?? [] {
            let si = servicios.firstIndex(of: s.uuid)
            for c in s.characteristics ?? [] {
                let w = c.properties.contains(.write) || c.properties.contains(.writeWithoutResponse)
                if !w { continue }
                var pts = 10
                if let ci = canalesConocidos.firstIndex(of: c.uuid) { pts = 1000 - ci }
                else if let si = si { pts = 500 - si }
                if c.properties.contains(.writeWithoutResponse) { pts += 1 }
                if pts > puntos { puntos = pts; mejor = c }
            }
        }
        return mejor
    }

    private func usar(_ c: CBCharacteristic) {
        canal = c
        sinRespuesta = c.properties.contains(.writeWithoutResponse)
        terminarConnect(ok: true, motivo: nil)
    }

    private func terminarConnect(ok: Bool, motivo: String?) {
        relojConnect?.cancel()
        relojConnect = nil
        guard let call = llamadaConnect else { return }
        llamadaConnect = nil
        if ok {
            call.resolve(["connected": true])
        } else {
            if let p = activa {
                cerrandoAMano = true
                central.cancelPeripheralConnection(p)
            }
            limpiarConexion()
            call.reject(motivo ?? "No se pudo conectar")
        }
    }

    private func limpiarConexion() {
        activa = nil
        canal = nil
        serviciosPendientes = 0
        if let w = llamadaWrite {
            llamadaWrite = nil
            cola.removeAll()
            relojWrite?.cancel()
            w.reject("Se perdió la conexión con la impresora")
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let p = activa {
            cerrandoAMano = true
            central.cancelPeripheralConnection(p)
        }
        if let c = llamadaConnect { llamadaConnect = nil; c.reject("Se canceló la conexión") }
        relojConnect?.cancel()
        limpiarConexion()
        call.resolve(["ok": true])
    }

    // MARK: - Escribir ESC/POS (con control de flujo)

    @objc func write(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"),
              let datos = Data(base64Encoded: b64) else {
            call.reject("Datos inválidos")
            return
        }
        guard let p = activa, p.state == .connected, canal != nil else {
            call.reject("No hay ninguna impresora conectada")
            return
        }
        if llamadaWrite != nil {
            call.reject("Espera, se está imprimiendo")
            return
        }
        // Las térmicas BLE baratas se atragantan con paquetes grandes.
        let tope = p.maximumWriteValueLength(for: sinRespuesta ? .withoutResponse : .withResponse)
        let paso = max(20, min(tope, 180))
        cola.removeAll()
        var i = 0
        while i < datos.count {
            let fin = min(i + paso, datos.count)
            cola.append(datos.subdata(in: i..<fin))
            i = fin
        }
        llamadaWrite = call
        esperandoAcuse = false

        relojWrite?.cancel()
        let reloj = DispatchWorkItem { [weak self] in
            guard let self = self, let w = self.llamadaWrite else { return }
            self.llamadaWrite = nil
            self.cola.removeAll()
            w.reject("La impresora dejó de recibir datos")
        }
        relojWrite = reloj
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: reloj)

        enviarSiguiente()
    }

    private func enviarSiguiente() {
        guard llamadaWrite != nil, let p = activa, let c = canal else { return }
        if cola.isEmpty {
            // Se le da un respiro para vaciar su búfer antes de decir "listo"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                guard let self = self, let w = self.llamadaWrite else { return }
                self.llamadaWrite = nil
                self.relojWrite?.cancel()
                w.resolve(["ok": true])
            }
            return
        }
        if sinRespuesta {
            // Control de flujo de iOS: si su cola está llena, se espera a peripheralIsReady
            guard p.canSendWriteWithoutResponse else { return }
            let trozo = cola.removeFirst()
            p.writeValue(trozo, for: c, type: .withoutResponse)
            // Respiro corto: muchas térmicas imprimen más lento de lo que reciben
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.008) { [weak self] in self?.enviarSiguiente() }
        } else {
            if esperandoAcuse { return }
            let trozo = cola.removeFirst()
            esperandoAcuse = true
            p.writeValue(trozo, for: c, type: .withResponse)
        }
    }

    public func peripheralIsReady(toSendWriteWithoutResponse p: CBPeripheral) {
        enviarSiguiente()
    }

    public func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        esperandoAcuse = false
        if let e = error, let w = llamadaWrite {
            llamadaWrite = nil
            cola.removeAll()
            relojWrite?.cancel()
            w.reject("La impresora rechazó los datos: \(e.localizedDescription)")
            return
        }
        enviarSiguiente()
    }

    // MARK: - Wi-Fi (socket TCP 9100, lo que el navegador NO puede hacer)

    @objc func netProbe(_ call: CAPPluginCall) {
        let host = call.getString("host") ?? ""
        let port = call.getInt("port") ?? 9100
        probar(host: host, port: port) { ok in call.resolve(["ok": ok]) }
    }

    @objc func netPrint(_ call: CAPPluginCall) {
        let host = call.getString("host") ?? ""
        let port = call.getInt("port") ?? 9100
        guard let b64 = call.getString("data"),
              let datos = Data(base64Encoded: b64) else {
            call.reject("Datos inválidos")
            return
        }
        enviar(host: host, port: port, datos: datos) { ok, motivo in
            if ok { call.resolve(["ok": true]) } else { call.reject(motivo ?? "No se pudo enviar") }
        }
    }

    private func conexion(host: String, port: Int) -> NWConnection? {
        let h = host.trimmingCharacters(in: .whitespaces)
        guard !h.isEmpty, port > 0, port < 65536,
              let p = NWEndpoint.Port(rawValue: UInt16(port)) else { return nil }
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = 6
        tcp.noDelay = true
        return NWConnection(host: NWEndpoint.Host(h), port: p, using: NWParameters(tls: nil, tcp: tcp))
    }

    /// Contesta UNA sola vez, desde el hilo principal.
    private final class UnaVez {
        private var hecho = false
        private let lock = NSLock()
        func intentar() -> Bool {
            lock.lock(); defer { lock.unlock() }
            if hecho { return false }
            hecho = true
            return true
        }
    }

    private func probar(host: String, port: Int, listo: @escaping (Bool) -> Void) {
        guard let conn = conexion(host: host, port: port) else { listo(false); return }
        let una = UnaVez()
        let fin: (Bool) -> Void = { ok in
            guard una.intentar() else { return }
            conn.cancel()
            DispatchQueue.main.async { listo(ok) }
        }
        conn.stateUpdateHandler = { estado in
            switch estado {
            case .ready: fin(true)
            case .failed, .cancelled: fin(false)
            default: break   // .waiting = sin ruta todavía; decide el reloj
            }
        }
        conn.start(queue: .global())
        DispatchQueue.global().asyncAfter(deadline: .now() + 4) { fin(false) }
    }

    private func enviar(host: String, port: Int, datos: Data,
                        listo: @escaping (Bool, String?) -> Void) {
        guard let conn = conexion(host: host, port: port) else {
            listo(false, "Dirección inválida"); return
        }
        let una = UnaVez()
        let fin: (Bool, String?) -> Void = { ok, motivo in
            guard una.intentar() else { return }
            DispatchQueue.main.async { listo(ok, motivo) }
        }
        conn.stateUpdateHandler = { estado in
            switch estado {
            case .ready:
                conn.send(content: datos, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { err in
                    if let e = err { conn.cancel(); fin(false, e.localizedDescription); return }
                    // Cierre ordenado: la impresora recibe todo antes de cortar
                    DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
                        conn.cancel()
                        fin(true, nil)
                    }
                })
            case .failed(let e):
                conn.cancel(); fin(false, "No responde la impresora en \(host):\(port) (\(e.localizedDescription))")
            default: break   // .waiting = sin ruta todavía; decide el reloj
            }
        }
        conn.start(queue: .global())
        DispatchQueue.global().asyncAfter(deadline: .now() + 20) {
            conn.cancel()
            fin(false, "La impresora en \(host):\(port) no contestó. Revisa que esté prendida y en la misma red Wi-Fi.")
        }
    }
}
