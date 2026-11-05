import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPush } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: true, shouldSetBadge: false,
  }),
});

export async function enablePush(): Promise<string> {
  if (!Device.isDevice) return 'Las alertas push requieren un teléfono físico.';
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'Plataforma no compatible.';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('smart-ppe-alerts', {
      name: 'Alertas de polvo', importance: AndroidImportance.MAX,
      sound: 'default', vibrationPattern: [0, 300, 180, 300],
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'Activa las notificaciones en los ajustes del teléfono.';
  const nativeToken = (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof nativeToken !== 'string') throw new Error('Token push no disponible.');
  let installationId = await AsyncStorage.getItem('smart-ppe-installation-id');
  if (!installationId) {
    installationId = Crypto.randomUUID();
    await AsyncStorage.setItem('smart-ppe-installation-id', installationId);
  }
  await registerPush(Platform.OS, nativeToken, installationId);
  return 'Alertas al celular activadas.';
}
