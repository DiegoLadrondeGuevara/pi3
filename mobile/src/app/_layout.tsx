import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../lib/amplify';

export default function Layout() {
  return <><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></>;
}
