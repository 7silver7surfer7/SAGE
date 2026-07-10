var should = require('chai').should();
var {PrismaClient} = require('@prisma/client');

describe('Search', function() {
    const prisma = new PrismaClient();

    describe('Tags', function() {
        it('should be able to find a drop with a tag containing dtoc', function() {
            prisma.drop.findFirst({
                where: {
                    tags: {
                        contains: 'dtoc'
                    },
                },
            }).then(result => {
                should.exist(result);
            });
        });

        it('should be able to find a drop with a tag containing anArtist', function() {
            return prisma.drop.findFirst({
                where: {
                    tags: {
                        contains: 'anArtist'
                    },
                },
            }).then(result => {
                should.exist(result);
            });
        });

        it('should not find a drop with a tag that does not exist', function() {
            return prisma.drop.findFirst({
                where: {
                    tags: {
                        contains: 'some tag that does not exist'
                    },
                },
            }).then(result => {
                should.not.exist(result);
            });
        });

        it('should be able to find an nft with a tag containing Japanese', function() {
            return prisma.nft.findFirst({
                where: {
                    tags: {
                        contains: 'Japanese'
                    },
                },
            }).then(result => {
                should.exist(result);
            });
        });

        it('should not find an nft with a tag that does not exist', function() {
            return prisma.nft.findFirst({
                where: {
                    tags: {
                        contains: 'some tag that does not exist'
                    },
                },
            }).then(result => {
                should.not.exist(result);
            });
        });

        it('should find an nft when a tag is an exact match', function() {
            return prisma.nft.findFirst({
                where: {
                    tags: {
                        contains: 'Japanese town night'
                    },
                },
            }).then(result => {
                should.exist(result);
            });
        });

        // TODO: add tests for searching for artists once artists are a model in the schema
    });
});