import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ShortLink } from '$api/short_link/model';
import { shortLinkSuffixValidator } from '$api/short_link/validator';

export const load = (async ({ params }) => {
	if (!(await shortLinkSuffixValidator.isValid(params.link))) {
		return error(404, 'Not Found');
	}

	// Count the visit atomically, and await it so it isn't dropped when the serverless function exits
	const link = await ShortLink.findOneAndUpdate({ suffix: params.link }, { $inc: { uses: 1 } })
		.select('url')
		.exec();
	if (!link) return error(404, 'Not Found');

	// 302 rather than 301, so browsers don't cache the destination and edits to the link take effect
	return redirect(302, link.url);
}) satisfies PageServerLoad;
