/**
 * Push notification registration. Asks for permission once, gets this phone's
 * Expo push token and stores it with Klasora so school updates reach it.
 * Quietly does nothing on simulators, when permission is refused, or before
 * the app is linked to an EAS project (push tokens need its project id).
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<'registered' | 'skipped'> {
  try {
    if (!Device.isDevice) return 'skipped';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'School updates',
        importance: Notifications.AndroidImportance.DEFAULT,
        // Private details never show on the lock screen unless the person opts in.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'skipped';

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return 'skipped';

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_device', {
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_token: token,
      p_name: Device.deviceName ?? Device.modelName ?? null,
    });
    return error ? 'skipped' : 'registered';
  } catch {
    return 'skipped';
  }
}
