import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { confirmSignUp, fetchAuthSession, signIn, signOut, signUp } from 'aws-amplify/auth';
import * as Notifications from 'expo-notifications';
import { Alert, claimDevice, getAlerts, getStatus, Status } from '../lib/api';
import { config, configured } from '../lib/amplify';
import { enablePush } from '../lib/push';

type Screen = 'loading' | 'auth' | 'confirm' | 'pair' | 'monitor';
type AuthMode = 'login' | 'signup';
const visual = {
  NORMAL: { icon: '✓', title: 'Lectura bajo umbral', detail: 'Continúa el monitoreo', color: '#087B51', bg: '#E7F6EF' },
  WARNING: { icon: '!', title: 'Precaución', detail: 'Lectura elevada. Revisa el área.', color: '#8A5700', bg: '#FFF3CC' },
  CRITICAL: { icon: '!', title: 'Alerta de polvo', detail: 'Aléjate del área y avisa al supervisor.', color: '#B32121', bg: '#FDE8E7' },
  OFFLINE: { icon: '×', title: 'Sensor sin conexión', detail: 'No hay datos recientes. Comprueba el cable y la PC.', color: '#5B6475', bg: '#EBEEF2' },
  NO_DATA: { icon: '–', title: 'Esperando lecturas', detail: 'Aún no llegan datos del dispositivo.', color: '#5B6475', bg: '#EBEEF2' },
  SERVICE_ERROR: { icon: '×', title: 'Sin conexión al servicio', detail: 'No se pudo consultar el estado. Revisa Internet y vuelve a intentar.', color: '#5B6475', bg: '#EBEEF2' },
} as const;

function readableTime(value?: string) {
  if (!value) return 'Sin datos';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Sin datos' : parsed.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' });
}

function Button({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
  </Pressable>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>(configured ? 'loading' : 'auth');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [message, setMessage] = useState(configured ? '' : 'Falta configurar API y Cognito en mobile/.env.');
  const [pushMessage, setPushMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getStatus();
      setStatus(nextStatus);
      const nextAlerts = await getAlerts().catch(() => ({ alerts: [] as Alert[] }));
      setAlerts(nextAlerts.alerts);
      setMessage('');
      setScreen('monitor');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'No se pudo cargar el monitor.';
      if (detail.includes('sin vincular')) setScreen('pair');
      else if (detail.includes('sesión venció')) setScreen('auth');
      else { setStatus(previous => ({ ...previous, deviceId: config.deviceId, status: 'SERVICE_ERROR', stale: true })); setScreen('monitor'); }
      setMessage(detail);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    fetchAuthSession().then(session => {
      if (session.tokens?.accessToken) refresh();
      else setScreen('auth');
    }).catch(() => setScreen('auth'));
  }, [refresh]);

  useEffect(() => {
    if (screen !== 'monitor') return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 10_000);
    const foreground = AppState.addEventListener('change', value => { if (value === 'active') refresh(); });
    const received = Notifications.addNotificationReceivedListener(() => { refresh(); });
    const tapped = Notifications.addNotificationResponseReceivedListener(() => { refresh(); });
    return () => { clearInterval(timer); foreground.remove(); received.remove(); tapped.remove(); };
  }, [screen, refresh]);

  useEffect(() => {
    if (screen !== 'monitor' || pushMessage) return;
    enablePush().then(setPushMessage).catch(error => {
      setPushMessage(error instanceof Error ? `Push pendiente: ${error.message}` : 'Push pendiente de configurar.');
    });
  }, [screen, pushMessage]);

  async function authenticate() {
    setBusy(true); setMessage('');
    try {
      const username = email.trim().toLowerCase();
      if (authMode === 'signup') {
        const result = await signUp({ username, password, options: { userAttributes: { email: username } } });
        if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') setScreen('confirm');
        else { setAuthMode('login'); setMessage('Cuenta creada. Ingresa con tu contraseña.'); }
      } else {
        const result = await signIn({ username, password });
        if (result.isSignedIn) await refresh();
        else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') setScreen('confirm');
        else throw new Error(`Se requiere otro paso de autenticación: ${result.nextStep.signInStep}`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Error de autenticación.'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setMessage('');
    try {
      await confirmSignUp({ username: email.trim().toLowerCase(), confirmationCode: code.trim() });
      setAuthMode('login'); setScreen('auth'); setMessage('Cuenta verificada. Ingresa para continuar.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Código incorrecto.'); }
    finally { setBusy(false); }
  }

  async function pair() {
    setBusy(true); setMessage('');
    try { await claimDevice(pairingCode.trim()); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo vincular.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await signOut(); setStatus(null); setAlerts([]); setPushMessage(''); setScreen('auth');
  }

  const state = visual[status?.status || 'NO_DATA'];
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View><Text style={styles.brand}>SMART-PPE</Text><Text style={styles.subtitle}>Monitoreo de polvo en obra</Text></View>
        {screen === 'monitor' && <Pressable accessibilityRole="button" onPress={logout}><Text style={styles.link}>Salir</Text></Pressable>}
      </View>

      {screen === 'loading' && <ActivityIndicator size="large" color="#087B51" style={styles.loader} />}

      {(screen === 'auth' || screen === 'confirm' || screen === 'pair') && <View style={styles.formCard}>
        <Text style={styles.formTitle}>{screen === 'pair' ? 'Vincular dispositivo' : screen === 'confirm' ? 'Verificar correo' : authMode === 'login' ? 'Ingresar' : 'Crear cuenta'}</Text>
        <Text style={styles.formHelp}>{screen === 'pair' ? 'Escribe el código entregado para este sensor.' : screen === 'confirm' ? 'Ingresa el código enviado a tu correo.' : 'Accede al monitor del dispositivo.'}</Text>
        {screen === 'auth' && <>
          <Text style={styles.inputLabel}>Correo electrónico</Text>
          <TextInput accessibilityLabel="Correo electrónico" placeholder="nombre@correo.com" placeholderTextColor="#7A8793" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} />
          <Text style={styles.inputLabel}>Contraseña</Text>
          <TextInput accessibilityLabel="Contraseña" placeholder="Contraseña" placeholderTextColor="#7A8793" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
          <Button title={busy ? 'Espera...' : authMode === 'login' ? 'Ingresar' : 'Crear cuenta'} disabled={busy || !configured} onPress={authenticate} />
          <Button title={authMode === 'login' ? 'Crear una cuenta' : 'Ya tengo cuenta'} secondary onPress={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setMessage(''); }} />
        </>}
        {screen === 'confirm' && <><Text style={styles.inputLabel}>Código de verificación</Text><TextInput accessibilityLabel="Código de verificación" placeholder="Código de verificación" placeholderTextColor="#7A8793" keyboardType="number-pad" value={code} onChangeText={setCode} style={styles.input} /><Button title="Verificar" disabled={busy} onPress={confirm} /></>}
        {screen === 'pair' && <><Text style={styles.inputLabel}>Código del dispositivo</Text><TextInput accessibilityLabel="Código del dispositivo" placeholder="Código del dispositivo" placeholderTextColor="#7A8793" value={pairingCode} onChangeText={setPairingCode} style={styles.input} /><Button title="Vincular" disabled={busy} onPress={pair} /><Button title="Salir" secondary onPress={logout} /></>}
      </View>}

      {screen === 'monitor' && <>
        <View style={[styles.hero, { backgroundColor: state.bg }]}>
          <View style={[styles.heroIcon, { backgroundColor: state.color }]}><Text style={styles.heroIconText}>{state.icon}</Text></View>
          <Text style={[styles.heroTitle, { color: state.color }]}>{state.title}</Text>
          <Text style={styles.heroDetail}>{state.detail}</Text>
          <Text style={styles.updated}>Última lectura: {readableTime(status?.observedAt)}</Text>
        </View>
        <Text style={styles.section}>Concentración estimada de polvo</Text>
        <View style={styles.readingCard}>
          <Text style={styles.readingLabel}>Promedio de 2 segundos</Text>
          <Text style={styles.readingValue}>{status?.average2s == null ? '—' : status.average2s.toFixed(1)} <Text style={styles.readingUnit}>µg/m³</Text></Text>
          <View style={styles.rule} />
          <Text style={styles.readingFoot}>Pico: {status?.peak2s == null ? '—' : status.peak2s.toFixed(1)} µg/m³</Text>
        </View>
        <Text style={styles.disclaimer}>Umbrales de demostración; el sensor y sus lecturas aún requieren calibración. Esta medición no certifica que el aire sea seguro.</Text>
        <View style={styles.row}><Text style={styles.section}>Alertas recientes</Text><Pressable accessibilityRole="button" onPress={refresh}><Text style={styles.link}>Actualizar</Text></Pressable></View>
        {alerts.length === 0 ? <Text style={styles.empty}>Aún no hay eventos registrados.</Text> : alerts.map(alert => <View key={alert.alertId} style={styles.alertRow}>
          <View style={[styles.dot, { backgroundColor: visual[alert.status]?.color || '#5B6475' }]} />
          <View style={styles.alertText}><Text style={styles.alertTitle}>{visual[alert.status]?.title || alert.status}</Text><Text style={styles.alertDate}>{readableTime(alert.occurredAt)}</Text></View>
          <Text style={styles.alertValue}>{alert.value == null ? '' : `${alert.value.toFixed(1)} µg/m³`}</Text>
        </View>)}
        <Text style={styles.footer}>Dispositivo: {config.deviceId} · {status?.mode === 'simulated' ? 'Datos simulados' : status?.mode === 'real' ? 'Modo real declarado' : 'Origen no verificado'}</Text>
        <Text style={styles.footer}>{pushMessage}</Text>
        {pushMessage.startsWith('Push pendiente') && <Button title="Reintentar alertas al celular" secondary onPress={() => { setPushMessage(''); }} />}
      </>}
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9FA' }, page: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  brand: { fontSize: 25, fontWeight: '800', color: '#142134', letterSpacing: 0.3 }, subtitle: { fontSize: 14, color: '#657181', marginTop: 3 },
  link: { color: '#087B51', fontSize: 14, fontWeight: '700' }, loader: { marginTop: 80 },
  formCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E7EB', borderRadius: 18, padding: 20, gap: 12 },
  formTitle: { fontSize: 23, fontWeight: '700', color: '#142134' }, formHelp: { color: '#657181', fontSize: 14, marginBottom: 6 },
  inputLabel: { color: '#142134', fontSize: 14, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D6DEE3', borderRadius: 10, padding: 13, fontSize: 16, color: '#142134', backgroundColor: '#FFFFFF' },
  button: { backgroundColor: '#087B51', padding: 14, borderRadius: 10, alignItems: 'center' }, buttonSecondary: { backgroundColor: '#E7F6EF' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 }, buttonTextSecondary: { color: '#087B51' }, disabled: { opacity: 0.5 },
  hero: { borderRadius: 20, padding: 25, alignItems: 'center', gap: 8 }, heroIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  heroIconText: { color: '#FFFFFF', fontSize: 42, fontWeight: '700' }, heroTitle: { fontSize: 29, fontWeight: '800', textAlign: 'center' },
  heroDetail: { color: '#344A48', fontSize: 16, textAlign: 'center', lineHeight: 22 }, updated: { color: '#657181', fontSize: 12, marginTop: 7 },
  section: { fontSize: 18, fontWeight: '700', color: '#142134', marginTop: 10 },
  readingCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E7EB', borderRadius: 16, padding: 20 },
  readingLabel: { fontSize: 14, color: '#657181' }, readingValue: { fontSize: 42, color: '#142134', fontWeight: '800', marginTop: 4 },
  readingUnit: { fontSize: 17, color: '#657181', fontWeight: '500' }, rule: { height: 1, backgroundColor: '#E2E7EB', marginVertical: 13 },
  readingFoot: { fontSize: 14, color: '#657181' }, disclaimer: { color: '#765A13', backgroundColor: '#FFF8E5', borderRadius: 10, padding: 12, lineHeight: 19, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, empty: { color: '#657181', fontSize: 14, paddingVertical: 12 },
  alertRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E7EB', padding: 13, gap: 12 },
  dot: { width: 11, height: 11, borderRadius: 6 }, alertText: { flex: 1 }, alertTitle: { color: '#142134', fontWeight: '700', fontSize: 14 },
  alertDate: { color: '#657181', fontSize: 12, marginTop: 2 }, alertValue: { color: '#657181', fontSize: 12 },
  footer: { color: '#697585', fontSize: 12, textAlign: 'center', marginTop: 8 }, error: { color: '#B32121', backgroundColor: '#FDE8E7', borderRadius: 10, padding: 12 },
});
