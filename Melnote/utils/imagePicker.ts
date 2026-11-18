import * as ImagePicker from 'expo-image-picker';
import { logError } from './errorLog';
import { showToast } from '../components/ui/Toast';

/**
 * Opens the system photo picker and always reports an outcome.
 *
 * Resolves with the picked file's uri, or `null` when the user backed out of
 * the picker. Failures are logged and surfaced as a toast instead of throwing
 * into an `async` event handler where nobody would see them.
 *
 * Callers that own a `Modal` should not call this directly: use
 * `components/ui/usePickerHost`, which keeps the dialog out of the way for the
 * duration of the pick. Android renders a `Modal` as a separate window and
 * only re-applies window flags to it when the activity resumes, which can
 * leave it blank but still swallowing touches.
 */
export async function pickImageFromLibrary(): Promise<string | null> {
    try {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });

        const asset = result.assets?.[0];
        if (result.canceled || !asset) return null;
        return asset.uri;
    } catch (error) {
        logError(error, 'js');
        showToast('That photo could not be loaded. Try again.');
        return null;
    }
}
