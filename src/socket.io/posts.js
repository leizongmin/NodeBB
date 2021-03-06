"use strict";

var	async = require('async'),
	nconf = require('nconf'),

	posts = require('../posts'),
	meta = require('../meta'),
	topics = require('../topics'),
	favourites = require('../favourites'),
	postTools = require('../postTools'),
	notifications = require('../notifications'),
	groups = require('../groups'),
	user = require('../user'),
	index = require('./index'),

	SocketPosts = {};

SocketPosts.reply = function(socket, data, callback) {

	if (!socket.uid && !parseInt(meta.config.allowGuestPosting, 10)) {
		socket.emit('event:alert', {
			title: 'Reply Unsuccessful',
			message: 'You don&apos;t seem to be logged in, so you cannot reply.',
			type: 'danger',
			timeout: 2000
		});
		return callback(new Error('not-logged-in'));
	}

	if(!data || !data.tid || !data.content) {
		return callback(new Error('invalid data'));
	}

	data.uid = socket.uid;

	topics.reply(data, function(err, postData) {
		if(err) {
			if (err.message === 'content-too-short') {
				module.parent.exports.emitContentTooShortAlert(socket);
			} else if (err.message === 'too-many-posts') {
				module.parent.exports.emitTooManyPostsAlert(socket);
			} else if (err.message === 'reply-error') {
				socket.emit('event:alert', {
					title: 'Reply Unsuccessful',
					message: 'Your reply could not be posted at this time. Please try again later.',
					type: 'warning',
					timeout: 2000
				});
			} else if (err.message === 'no-privileges') {
				socket.emit('event:alert', {
					title: 'Unable to post',
					message: 'You do not have posting privileges in this category.',
					type: 'danger',
					timeout: 7500
				});
			}
			return callback(err);
		}

		if (postData) {

			module.parent.exports.emitTopicPostStats();

			socket.emit('event:alert', {
				title: 'Reply Successful',
				message: 'You have successfully replied. Click here to view your reply.',
				type: 'success',
				timeout: 2000
			});
			var socketData = {
				posts: [postData]
			};

			index.server.sockets.emit('event:new_post', socketData);

			callback();
		}
	});
};

SocketPosts.upvote = function(socket, data) {
	favouriteCommand('upvote', socket, data);
};

SocketPosts.downvote = function(socket, data) {
	favouriteCommand('downvote', socket, data);
};

SocketPosts.unvote = function(socket, data) {
	favouriteCommand('unvote', socket, data);
};

SocketPosts.favourite = function(socket, data) {
	favouriteCommand('favourite', socket, data);
};

SocketPosts.unfavourite = function(socket, data) {
	favouriteCommand('unfavourite', socket, data);
};

function favouriteCommand(command, socket, data) {
	if(data && data.pid && data.room_id) {
		favourites[command](data.pid, data.room_id, socket.uid, socket);
	}
}

SocketPosts.getRawPost = function(socket, pid, callback) {
	posts.getPostFields(pid, ['content', 'deleted'], function(err, data) {
		if(err) {
			return callback(err);
		}

		if(data.deleted === '1') {
			return callback(new Error('This post no longer exists'));
		}

		callback(null, data.content);
	});
};

SocketPosts.edit = function(socket, data, callback) {
	if(!socket.uid) {
		socket.emit('event:alert', {
			title: 'Can&apos;t edit',
			message: 'Guests can&apos;t edit posts!',
			type: 'warning',
			timeout: 2000
		});
		return callback(new Error('not-logged-in'));
	} else if(!data || !data.pid || !data.title || !data.content) {
		return callback(new Error('invalid data'));
	} else if (!data.title || data.title.length < parseInt(meta.config.minimumTitleLength, 10)) {
		topics.emitTitleTooShortAlert(socket);
		return callback(new Error('title-too-short'));
	} else if (!data.content || data.content.length < parseInt(meta.config.minimumPostLength, 10)) {
		module.parent.exports.emitContentTooShortAlert(socket);
		return callback(new Error('content-too-short'));
	}

	postTools.edit(socket.uid, data.pid, data.title, data.content, {topic_thumb: data.topic_thumb}, function(err, results) {
		if(err) {
			return callback(err);
		}

		index.server.sockets.in('topic_' + results.topic.tid).emit('event:post_edited', {
			pid: data.pid,
			title: results.topic.title,
			isMainPost: results.topic.isMainPost,
			content: results.content
		});

		callback();
	});
};

SocketPosts.delete = function(socket, data, callback) {
	deleteOrRestore('delete', socket, data, callback);
};

SocketPosts.restore = function(socket, data, callback) {
	deleteOrRestore('restore', socket, data, callback);
};

function deleteOrRestore(command, socket, data, callback) {
	if(!data) {
		return callback(new Error('invalid data'));
	}

	postTools[command](socket.uid, data.pid, function(err) {
		if(err) {
			return callback(err);
		}

		module.parent.exports.emitTopicPostStats();

		var eventName = command === 'restore' ? 'event:post_restored' : 'event:post_deleted';
		index.server.sockets.in('topic_' + data.tid).emit(eventName, {
			pid: data.pid
		});

		callback();
	});
}

SocketPosts.getPrivileges = function(socket, pid, callback) {
	postTools.privileges(pid, socket.uid, function(err, privileges) {
		if(err) {
			return callback(err);
		}
		privileges.pid = parseInt(pid, 10);
		callback(null, privileges);
	});
};

SocketPosts.getFavouritedUsers = function(socket, pid, callback) {

	favourites.getFavouritedUidsByPids([pid], function(err, data) {

		if(err) {
			return callback(err);
		}

		if(!Array.isArray(data) || !data.length) {
			callback(null, "");
		}

		var max = 5; //hardcoded
		var finalText = "";

		var pid_uids = data[0];
		var rest_amount = 0;

		if (pid_uids.length > max) {
			rest_amount = pid_uids.length - max;
			pid_uids = pid_uids.slice(0, max);
		}

		user.getUsernamesByUids(pid_uids, function(err, usernames) {
			if(err) {
				return callback(err);
			}

			finalText = usernames.join(', ') + (rest_amount > 0 ?
				(" and " + rest_amount + (rest_amount > 1 ? " others" : " other")) : "");
			callback(null, finalText);
		});
	});
};

SocketPosts.getPidPage = function(socket, pid, callback) {
	posts.getPidPage(pid, socket.uid, callback);
};

SocketPosts.getPidIndex = function(socket, pid, callback) {
	posts.getPidIndex(pid, callback);
};

SocketPosts.flag = function(socket, pid, callback) {
	if (!socket.uid) {
		return callback(new Error('not-logged-in'));
	}

	var message = '',
		path = '';

	async.waterfall([
		function(next) {
			user.getUserField(socket.uid, 'username', next);
		},
		function(username, next) {
			message = username + ' flagged a post.';
			posts.getPostField(pid, 'tid', next);
		},
		function(tid, next) {
			topics.getTopicField(tid, 'slug', next);
		},
		function(topicSlug, next) {
			path = nconf.get('relative_path') + '/topic/' + topicSlug + '#' + pid;
			groups.getByGroupName('administrators', {}, next);
		},
		function(adminGroup, next) {
			notifications.create({
				text: message,
				path: path,
				uniqueId: 'post_flag:' + pid,
				from: socket.uid
			}, function(nid) {
				notifications.push(nid, adminGroup.members, function() {
					next(null);
				});
			});
		}
	], callback);
};

SocketPosts.loadMoreFavourites = function(socket, data, callback) {
	if(!data || !data.after) {
		return callback(new Error('invalid data'));
	}

	var start = parseInt(data.after, 10),
		end = start + 9;

	posts.getFavourites(socket.uid, start, end, callback);
};

SocketPosts.loadMoreUserPosts = function(socket, data, callback) {
	if(!data || !data.after || !data.uid) {
		return callback(new Error('invalid data'));
	}

	var start = parseInt(data.after, 10),
		end = start + 9;

	posts.getPostsByUid(socket.uid, data.uid, start, end, callback);
};


SocketPosts.getRecentPosts = function(socket, data, callback) {
	if(!data || !data.count) {
		return callback(new Error('invalid data'));
	}

	posts.getRecentPosts(socket.uid, 0, data.count - 1, data.term, callback);
};


module.exports = SocketPosts;