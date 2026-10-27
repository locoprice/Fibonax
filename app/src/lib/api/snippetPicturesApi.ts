import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { downscaleImage } from '@/lib/imageResize';
import {
  PICTURE_BUCKET,
  PICTURE_MAX_BYTES,
  PICTURE_MAX_WIDTH,
  pictureFileError,
  picturePath,
  shrinksBeforeUpload,
} from '@/lib/pictureToken';

/**
 * Pictures in snippets (Add a picture in the editor). Uploaded once and kept:
 * a picture taken out of a snippet stays in storage, because emails already
 * sent still show it. Account deletion empties the person's folder
 * (services/supabase/functions/delete-account).
 */
export const snippetPicturesApi = {
  /** Uploads a chosen picture and returns its public https address. */
  async upload(file: File): Promise<string> {
    const badSource = pictureFileError(file);
    if (badSource) throw new Error(badSource);

    const prepared = shrinksBeforeUpload(file.type)
      ? await downscaleImage(file, { maxWidth: PICTURE_MAX_WIDTH, maxBytes: PICTURE_MAX_BYTES })
      : file;
    if (prepared.size > PICTURE_MAX_BYTES) throw new Error('Choose a picture of 5 MB or less.');

    const { data, error } = await supabase.auth.getUser();
    if (error) throw toApiError(error);
    if (!data.user) throw new Error('Your session has ended. Sign in again, then retry.');

    // A new name for every upload, so a picture's address never shows another one.
    const path = picturePath(data.user.id, prepared.type, crypto.randomUUID());
    const { error: uploadErr } = await supabase.storage
      .from(PICTURE_BUCKET)
      .upload(path, prepared, { contentType: prepared.type, cacheControl: '31536000' });
    if (uploadErr) throw toApiError(uploadErr);

    return supabase.storage.from(PICTURE_BUCKET).getPublicUrl(path).data.publicUrl;
  },
};
