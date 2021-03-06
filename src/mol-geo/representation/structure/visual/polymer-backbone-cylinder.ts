/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ValueCell } from 'mol-util/value-cell'

import { createMeshRenderObject, MeshRenderObject } from 'mol-gl/render-object'
import { Unit } from 'mol-model/structure';
import { DefaultStructureProps, UnitsVisual } from '..';
import { RuntimeContext } from 'mol-task'
import { createTransforms, createColors } from './util/common';
import { deepEqual } from 'mol-util';
import { MeshValues } from 'mol-gl/renderable';
import { getMeshData } from '../../../util/mesh-data';
import { Mesh } from '../../../shape/mesh';
import { PickingId } from '../../../util/picking';
import { createMarkers, MarkerAction } from '../../../util/marker-data';
import { Loci } from 'mol-model/loci';
import { SizeTheme } from '../../../theme';
import { createMeshValues, updateMeshValues, updateRenderableState, createRenderableState, DefaultMeshProps } from '../../util';
import { MeshBuilder } from '../../../shape/mesh-builder';
import { getPolymerElementCount, PolymerBackboneIterator } from './util/polymer';
import { getElementLoci, markElement } from './util/element';
import { Vec3 } from 'mol-math/linear-algebra';

async function createPolymerBackboneCylinderMesh(ctx: RuntimeContext, unit: Unit, mesh?: Mesh) {
    const polymerElementCount = getPolymerElementCount(unit)
    if (!polymerElementCount) return Mesh.createEmpty(mesh)
    console.log('polymerElementCount backbone', polymerElementCount)

    // TODO better vertex count estimates
    const builder = MeshBuilder.create(polymerElementCount * 30, polymerElementCount * 30 / 2, mesh)

    const { elements } = unit
    const pos = unit.conformation.invariantPosition
    const pA = Vec3.zero()
    const pB = Vec3.zero()

    let i = 0
    const polymerBackboneIt = PolymerBackboneIterator(unit)
    while (polymerBackboneIt.hasNext) {
        // TODO size theme
        const { centerA, centerB } = polymerBackboneIt.move()
        pos(centerA.element, pA)
        pos(centerB.element, pB)
        builder.setId(elements[centerA.element])
        builder.addCylinder(pA, pB, 0.5, { radiusTop: 0.2, radiusBottom: 0.2 })
        builder.setId(elements[centerB.element])
        builder.addCylinder(pB, pA, 0.5, { radiusTop: 0.2, radiusBottom: 0.2 })

        if (i % 10000 === 0 && ctx.shouldUpdate) {
            await ctx.update({ message: 'Backbone mesh', current: i, max: polymerElementCount });
        }
        ++i
    }

    return builder.getMesh()
}

export const DefaultPolymerBackboneProps = {
    ...DefaultMeshProps,
    ...DefaultStructureProps,
    sizeTheme: { name: 'physical', factor: 1 } as SizeTheme,
    detail: 0,
    unitKinds: [ Unit.Kind.Atomic, Unit.Kind.Spheres ] as Unit.Kind[]
}
export type PolymerBackboneProps = Partial<typeof DefaultPolymerBackboneProps>

export function PolymerBackboneVisual(): UnitsVisual<PolymerBackboneProps> {
    let renderObject: MeshRenderObject
    let currentProps: typeof DefaultPolymerBackboneProps
    let mesh: Mesh
    let currentGroup: Unit.SymmetryGroup

    return {
        get renderObject () { return renderObject },
        async create(ctx: RuntimeContext, group: Unit.SymmetryGroup, props: PolymerBackboneProps = {}) {
            currentProps = Object.assign({}, DefaultPolymerBackboneProps, props)
            currentGroup = group

            const { colorTheme, unitKinds } = { ...DefaultPolymerBackboneProps, ...props }
            const instanceCount = group.units.length
            const elementCount = group.elements.length
            const unit = group.units[0]

            mesh = unitKinds.includes(unit.kind)
                ? await createPolymerBackboneCylinderMesh(ctx, unit, mesh)
                : Mesh.createEmpty(mesh)
            // console.log(mesh)

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
                aColor: ValueCell.create(new Float32Array(mesh.vertexCount * 3))
            }
            const state = createRenderableState(currentProps)

            renderObject = createMeshRenderObject(values, state)
        },
        async update(ctx: RuntimeContext, props: PolymerBackboneProps) {
            const newProps = Object.assign({}, currentProps, props)

            if (!renderObject) return false

            let updateColor = false

            if (newProps.detail !== currentProps.detail) {
                const unit = currentGroup.units[0]
                mesh = await createPolymerBackboneCylinderMesh(ctx, unit, mesh)
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
            return getElementLoci(renderObject.id, currentGroup, pickingId)
        },
        mark(loci: Loci, action: MarkerAction) {
            markElement(renderObject.values.tMarker, currentGroup, loci, action)
        },
        destroy() {
            // TODO
        }
    }
}
