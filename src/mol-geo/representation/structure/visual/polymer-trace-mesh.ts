/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ValueCell } from 'mol-util/value-cell'

import { createMeshRenderObject, MeshRenderObject } from 'mol-gl/render-object'
import { Unit, Element } from 'mol-model/structure';
import { DefaultStructureProps, UnitsVisual } from '../index';
import { RuntimeContext } from 'mol-task'
import { createTransforms, createColors } from './util/common';
import { markElement } from './util/element';
import { deepEqual } from 'mol-util';
import { MeshValues } from 'mol-gl/renderable';
import { getMeshData } from '../../../util/mesh-data';
import { Mesh } from '../../../shape/mesh';
import { PickingId } from '../../../util/picking';
import { OrderedSet } from 'mol-data/int';
import { createMarkers, MarkerAction } from '../../../util/marker-data';
import { Loci, EmptyLoci } from 'mol-model/loci';
import { SizeTheme } from '../../../theme';
import { createMeshValues, updateMeshValues, updateRenderableState, createRenderableState, DefaultMeshProps } from '../../util';
import { MeshBuilder } from '../../../shape/mesh-builder';
import { getPolymerElementCount, PolymerBackboneIterator } from './util/polymer';

async function createPolymerTraceMesh(ctx: RuntimeContext, unit: Unit, mesh?: Mesh) {
    const polymerElementCount = getPolymerElementCount(unit)
    console.log('polymerElementCount', polymerElementCount)
    if (!polymerElementCount) return Mesh.createEmpty(mesh)

    // TODO better vertex count estimates
    const builder = MeshBuilder.create(polymerElementCount * 30, polymerElementCount * 30 / 2, mesh)

    let i = 0
    const polymerTraceIt = PolymerBackboneIterator(unit)
    while (polymerTraceIt.hasNext) {
        const v = polymerTraceIt.move()
        builder.setId(v.indexA)
        // TODO size theme
        builder.addCylinder(v.posA, v.posB, 0.5, { radiusTop: 0.2, radiusBottom: 0.2 })
        builder.setId(v.indexB)
        builder.addCylinder(v.posB, v.posA, 0.5, { radiusTop: 0.2, radiusBottom: 0.2 })

        if (i % 10000 === 0 && ctx.shouldUpdate) {
            await ctx.update({ message: 'Backbone mesh', current: i, max: polymerElementCount });
        }
        ++i
    }

    return builder.getMesh()
}

export const DefaultPolymerTraceProps = {
    ...DefaultMeshProps,
    ...DefaultStructureProps,
    sizeTheme: { name: 'physical', factor: 1 } as SizeTheme,
    detail: 0,
    unitKinds: [ Unit.Kind.Atomic, Unit.Kind.Spheres ] as Unit.Kind[]
}
export type PolymerTraceProps = Partial<typeof DefaultPolymerTraceProps>

export function PolymerTraceVisual(): UnitsVisual<PolymerTraceProps> {
    let renderObject: MeshRenderObject
    let currentProps: typeof DefaultPolymerTraceProps
    let mesh: Mesh
    let currentGroup: Unit.SymmetryGroup

    return {
        get renderObject () { return renderObject },
        async create(ctx: RuntimeContext, group: Unit.SymmetryGroup, props: PolymerTraceProps = {}) {
            currentProps = Object.assign({}, DefaultPolymerTraceProps, props)
            currentGroup = group

            const { colorTheme, unitKinds } = { ...DefaultPolymerTraceProps, ...props }
            const instanceCount = group.units.length
            const elementCount = group.elements.length
            const unit = group.units[0]

            mesh = unitKinds.includes(unit.kind)
                ? await createPolymerTraceMesh(ctx, unit, mesh)
                : Mesh.createEmpty(mesh)

            const transforms = createTransforms(group)
            const color = createColors(group, elementCount, colorTheme)
            const marker = createMarkers(instanceCount * elementCount)

            const counts = { drawCount: mesh.triangleCount * 3, elementCount, instanceCount }

            const values: MeshValues = {
                ...getMeshData(mesh),
                ...color,
                ...marker,
                aTransform: transforms,
                elements: mesh.indexBuffer,
                ...createMeshValues(currentProps, counts),
            }
            const state = createRenderableState(currentProps)

            renderObject = createMeshRenderObject(values, state)
        },
        async update(ctx: RuntimeContext, props: PolymerTraceProps) {
            const newProps = Object.assign({}, currentProps, props)

            if (!renderObject) return false

            let updateColor = false

            if (newProps.detail !== currentProps.detail) {
                const unit = currentGroup.units[0]
                mesh = await createPolymerTraceMesh(ctx, unit, mesh)
                ValueCell.update(renderObject.values.drawCount, mesh.triangleCount * 3)
                updateColor = true
            }

            if (!deepEqual(newProps.colorTheme, currentProps.colorTheme)) {
                updateColor = true
            }

            if (updateColor) {
                const elementCount = currentGroup.elements.length
                if (ctx.shouldUpdate) await ctx.update('Computing trace colors');
                createColors(currentGroup, elementCount, newProps.colorTheme, renderObject.values)
            }

            updateMeshValues(renderObject.values, newProps)
            updateRenderableState(renderObject.state, newProps)

            currentProps = newProps
            return true
        },
        getLoci(pickingId: PickingId) {
            const { objectId, instanceId, elementId } = pickingId
            if (renderObject.id === objectId) {
                const unit = currentGroup.units[instanceId]
                const indices = OrderedSet.ofSingleton(elementId as Element.Index);
                return Element.Loci([{ unit, indices }])
            }
            return EmptyLoci
        },
        mark(loci: Loci, action: MarkerAction) {
            markElement(renderObject.values.tMarker, currentGroup, loci, action)
        },
        destroy() {
            // TODO
        }
    }
}