/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

precision highp float;
precision highp int;

#pragma glslify: import('./chunks/common-frag-params.glsl')
#pragma glslify: import('./chunks/color-frag-params.glsl')

uniform float uAlpha;

void main(){
    #pragma glslify: import('./chunks/assign-material-color.glsl')
    
    gl_FragColor = vec4(material, uAlpha);

    #pragma glslify: import('./chunks/apply-marker-color.glsl')
    #pragma glslify: import('./chunks/apply-fog.glsl')
}