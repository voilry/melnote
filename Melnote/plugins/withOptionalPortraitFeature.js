const { withAndroidManifest } = require('expo/config-plugins');

const PORTRAIT_FEATURE = 'android.hardware.screen.portrait';

/**
 * Keep portrait orientation as the preferred activity orientation without
 * making portrait-only hardware mandatory for Google Play device filtering.
 */
module.exports = function withOptionalPortraitFeature(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const usesFeatures = manifest['uses-feature'] ?? [];
    const portraitFeature = usesFeatures.find(
      (feature) => feature.$?.['android:name'] === PORTRAIT_FEATURE
    );

    if (portraitFeature) {
      portraitFeature.$ = {
        ...portraitFeature.$,
        'android:required': 'false',
      };
    } else {
      usesFeatures.push({
        $: {
          'android:name': PORTRAIT_FEATURE,
          'android:required': 'false',
        },
      });
    }

    manifest['uses-feature'] = usesFeatures;
    return config;
  });
};
