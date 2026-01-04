module.exports = async (req, res) => {
  const { Innertube, YTNodes } = await import('youtubei.js');

  const { id: fullId, depth: qDepth, token: qToken } = req.query;

  if (!fullId) {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  async function getBase64(url) {
    if (!url) return '';
    try {
      const imgRes = await fetch(url);
      const buffer = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
    } catch (e) {
      return '';
    }
  }

  let videoId = fullId;
  let depth = parseInt(qDepth || '0', 10);
  let token = qToken || '';

  if (fullId.includes('==')) {
    const segments = fullId.split('==');
    videoId = segments[0];
    segments.forEach(seg => {
      if (seg.startsWith('token=')) token = seg.split('=')[1];
      if (seg.startsWith('depth=')) depth = parseInt(seg.split('=')[1], 10);
    });
  }

  try {
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    const basic = info.basic_info;

    const mainThumbnailBase64 = await getBase64(basic.thumbnail?.[0]?.url);
    const descriptionLines = (basic.description || "").split('\n');

    let relatedRaw = [];
    let nextContToken = token || null;

    const extract = (data) => data.contents?.item(0)?.as(YTNodes.SectionList)
      ?.contents?.filterType(YTNodes.CompactVideo) || [];

    const initialWatchNext = await info.getWatchNextContinuation(nextContToken || undefined);
    relatedRaw = extract(initialWatchNext);
    nextContToken = initialWatchNext.continuation || null;

    if (depth > 0) {
      for (let i = 0; i < depth; i++) {
        if (!nextContToken) break;
        const nextRes = await info.getWatchNextContinuation(nextContToken);
        relatedRaw = [...relatedRaw, ...extract(nextRes)];
        nextContToken = nextRes.continuation || null;
      }
    }

    const formattedRelated = await Promise.all(relatedRaw.map(async (v) => ({
      type: "video",
      videoId: v.id,
      title: v.title.toString(),
      duration: v.duration_text?.toString() || "",
      thumbnail: await getBase64(v.thumbnails?.[0]?.url),
      channelName: v.author?.name?.toString() || "",
      viewCountText: v.view_count?.toString() || "",
      publishedTimeText: v.published_time?.toString() || "",
      badge: v.badges?.map(b => b.label).join(' ') || (v.is_live ? 'LIVE' : '')
    })));

    res.status(200).json({
      id: videoId,
      title: basic.title,
      views: basic.view_count?.toString() + " 回視聴",
      relativeDate: info.primary_info?.published.toString() || "",
      likes: info.primary_info?.short_view_count?.text?.toString() || "",
      thumbnail: mainThumbnailBase64,
      author: {
        id: basic.channel_id,
        name: basic.author,
        subscribers: info.secondary_info?.subscribe_button?.as(YTNodes.SubscribeButton).subscriber_count?.toString() || "",
        thumbnail: info.secondary_info?.author?.thumbnails?.[0]?.url || "",
        collaborator: false,
        collaborators: []
      },
      description: {
        text: basic.description || "",
        formatted: (basic.description || "").replace(/\n/g, '<br>'),
        run0: descriptionLines[0] || "",
        run1: descriptionLines[1] || "",
        run2: descriptionLines[2] || "",
        run3: descriptionLines[3] || ""
      },
      "Related-videos": {
        relatedCount: formattedRelated.length,
        nextContinuationToken: nextContToken,
        relatedVideos: formattedRelated
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
