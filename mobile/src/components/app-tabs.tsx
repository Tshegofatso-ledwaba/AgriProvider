import { NativeTabs } from 'expo-router/native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';

export default function AppTabs() {
  const scheme = useColorScheme();
  const { user } = useAuth();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      hidden={!user}
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {user?.role === 'provider' ? (
        <NativeTabs.Trigger name="programmes">
          <NativeTabs.Trigger.Label>Programmes</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/explore.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user?.role === 'provider' ? (
        <NativeTabs.Trigger name="learners">
          <NativeTabs.Trigger.Label>Learners</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/home.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user?.role === 'provider' ? (
        <NativeTabs.Trigger name="enrolments">
          <NativeTabs.Trigger.Label>Enrolments</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/explore.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user?.role === 'assessor' ? (
        <NativeTabs.Trigger name="assessor">
          <NativeTabs.Trigger.Label>Review queue</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/explore.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user?.role === 'admin' ? (
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Label>Assignments</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/explore.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user?.role === 'qa' ? (
        <NativeTabs.Trigger name="qa">
          <NativeTabs.Trigger.Label>Quality assurance</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/explore.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}

      {user ? (
        <NativeTabs.Trigger name="explore" hidden>
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/home.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      ) : null}
    </NativeTabs>
  );
}
