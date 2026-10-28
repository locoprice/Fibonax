import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar } from '@/components/shared/Avatar';
import { AvatarStack } from '@/components/shared/AvatarStack';

// A teammate's face: the photo they set in Settings → Account, else an initial.
// These pin what the Team page, the folder faces and the share window rely on.

describe('Avatar', () => {
  it('shows the initial of the name, or of the email, when there is no photo', () => {
    expect(renderToStaticMarkup(<Avatar name="Valentina" email="v@example.com" />)).toContain('>V<');
    expect(renderToStaticMarkup(<Avatar name="" email="marco@example.com" />)).toContain('>M<');
    expect(renderToStaticMarkup(<Avatar />)).toContain('>?<');
  });

  it('shows the photo as a decorative image inside the labelled circle', () => {
    const html = renderToStaticMarkup(<Avatar name="Valentina" src="https://x.test/a.png" />);
    expect(html).toContain('<img src="https://x.test/a.png" alt=""');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Valentina"');
    expect(html).not.toContain('>V<');
  });

  it('marks the current user on the initial only, never over a photo', () => {
    expect(renderToStaticMarkup(<Avatar name="A" highlight />)).toContain('bg-primary text-white');
    expect(renderToStaticMarkup(<Avatar name="A" highlight src="https://x.test/a.png" />)).not.toContain(
      'bg-primary text-white',
    );
  });
});

describe('AvatarStack', () => {
  it('hands each face its photo and folds the rest into +N', () => {
    const html = renderToStaticMarkup(
      <AvatarStack
        members={[
          { id: '1', name: 'Anna', avatar: 'https://x.test/a.png' },
          { id: '2', name: 'Bruno' },
          { id: '3', name: 'Carla' },
        ]}
        max={2}
      />,
    );
    expect(html).toContain('src="https://x.test/a.png"');
    expect(html).toContain('>B<');
    expect(html).not.toContain('>C<');
    expect(html).toContain('+1');
  });
});
