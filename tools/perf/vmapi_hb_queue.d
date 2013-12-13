#!/usr/sbin/dtrace -s
/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * vmapi_cache_stats.d		Prints a message every time a heartbeat is being
 *                          invalidated and prints a summary of heartbeat
 *                          processing activity for the period of time this
 *                          script ran
 *
 * USAGE: vmapi_cache_stats.d
 *
 * Requires the node DTrace provider, and a working version of the node
 * translator (/usr/lib/dtrace/node.d).
 */

#pragma D option quiet
#pragma D option defaultargs
#pragma D option dynvarsize=8m
#pragma D option switchrate=10

dtrace:::BEGIN
{
	printf("Tracing VMAPI's heartbeat queue\n");
}

/*
 *                			  length, concurrency
 * 'heartbeat-queue-prepush': ['int', 'int'],
 */
vmapi*:::heartbeat-queue-push
{
	/* printf("Element pushed -- current queue state is: %d/%d\n",
		args[0], args[1]); */
	@length["queue length"] = quantize(args[0]);
}

/*
 * 'heartbeat-queue-saturated': [ 'int' ],
 */
vmapi*:::heartbeat-queue-saturated
{
	printf("Queue has been saturated!\n");
}

/*
 * 'heartbeat-queue-drain': [ 'int' ],
 */
vmapi*:::heartbeat-queue-drain
{
	printf("Queue has been drained!\n");
}
